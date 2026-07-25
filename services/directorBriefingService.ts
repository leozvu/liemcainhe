import { Character, CreativeDirectorMission, ProjectState } from '../types';
import { ModelType } from '../types/model';
import { ClientMemory, buildClientMemory, buildMemoryPromptContext } from './content/clientMemoryService';
import { ConsistencyReadiness, assessCharacterReadiness } from './consistencyService';
import { KindCalibration, KIND_LABELS, computeCalibration, readCalibrationRecords } from './supervisorCalibrationService';
import { ProviderHealth, getProviderHealth } from './providerHealthService';
import { SavedArticle } from '../types/content';
import { PublishLedgerEntry } from './content/publishLedgerService';
import { getModels } from './modelRegistry';
import { getUsagePolicy, getUsageRecords } from './usageService';

/**
 * Bản giao ban cho Đạo diễn AI.
 *
 * Creative Director hiện có sáu công cụ, **cả sáu đều để sinh**. Nó lập kế
 * hoạch rồi bấm nút, nhưng không biết gì về thứ hệ thống đã học được: khách
 * này từng duyệt kiểu bài nào, nhà cung cấp nào đang chết, cảnh báo nào đáng
 * tin, nhân vật nào chưa đủ ảnh, và còn bao nhiêu tiền.
 *
 * Lớp này gộp kết quả của bốn epic trước thành một khối ngữ cảnh để Đạo diễn
 * đọc **trước khi** lập kế hoạch. Đó mới là chỗ "trí tuệ" nằm: không phải gọi
 * thêm model, mà là đưa cho model những gì hệ thống đã biết.
 */

export type BudgetStatus = 'unset' | 'ok' | 'warning' | 'exceeded';

export interface BudgetSnapshot {
  ceilingUsd?: number;
  spentUsd: number;
  remainingUsd?: number;
  status: BudgetStatus;
  /** Tỷ lệ đã tiêu, 0 đến 1. `null` khi chưa đặt trần. */
  usedRatio: number | null;
}

/** Vượt mức này thì cảnh báo, dù chưa chạm trần. */
export const BUDGET_WARNING_RATIO = 0.8;

/**
 * Tiền đã tiêu cho dự án này.
 *
 * Đọc từ nhật ký usage sẵn có, cùng nguồn với bảng chi phí, nên hai nơi không
 * bao giờ nói hai con số khác nhau.
 */
export const computeBudget = (
  projectId: string | undefined,
  ceilingUsd?: number,
  records = getUsageRecords(),
): BudgetSnapshot => {
  const spentUsd = records
    .filter((record) => !projectId || record.projectId === projectId)
    .reduce((sum, record) => sum + (record.estimatedCostUsd || 0), 0);

  const spent = Math.round(spentUsd * 100) / 100;

  if (!ceilingUsd || ceilingUsd <= 0) {
    return { spentUsd: spent, status: 'unset', usedRatio: null };
  }

  const ratio = spent / ceilingUsd;
  return {
    ceilingUsd,
    spentUsd: spent,
    remainingUsd: Math.round((ceilingUsd - spent) * 100) / 100,
    usedRatio: Math.round(ratio * 100) / 100,
    status: ratio >= 1 ? 'exceeded' : ratio >= BUDGET_WARNING_RATIO ? 'warning' : 'ok',
  };
};

export interface MissionBudgetVerdict {
  allowed: boolean;
  reason?: string;
  /** Tổng chi phí dự kiến của kế hoạch. */
  missionCostUsd: number;
  /** Tiền còn lại sau khi chạy xong, nếu có trần. */
  remainingAfterUsd?: number;
}

/**
 * Kế hoạch này có chạy được trong ngân sách không.
 *
 * Chặn **trước khi** chạy, không phải phát hiện lúc đã tiêu quá. Đây là điểm
 * khác biệt của Epic 5: Đạo diễn biết giá của kế hoạch trước khi bấm.
 */
export const checkMissionBudget = (
  mission: Pick<CreativeDirectorMission, 'estimatedCostUsd'>,
  budget: BudgetSnapshot,
): MissionBudgetVerdict => {
  const missionCostUsd = Math.round((mission.estimatedCostUsd || 0) * 100) / 100;

  if (budget.status === 'unset') {
    return { allowed: true, missionCostUsd };
  }

  const remainingAfterUsd = Math.round(((budget.remainingUsd ?? 0) - missionCostUsd) * 100) / 100;

  if (budget.status === 'exceeded') {
    return {
      allowed: false,
      missionCostUsd,
      remainingAfterUsd,
      reason: `Dự án đã tiêu ${budget.spentUsd} USD, vượt trần ${budget.ceilingUsd} USD. Nâng trần hoặc đóng bớt việc trước khi chạy thêm.`,
    };
  }

  if (remainingAfterUsd < 0) {
    return {
      allowed: false,
      missionCostUsd,
      remainingAfterUsd,
      reason: `Kế hoạch tốn khoảng ${missionCostUsd} USD nhưng chỉ còn ${budget.remainingUsd} USD. Thiếu ${Math.abs(remainingAfterUsd)} USD.`,
    };
  }

  return { allowed: true, missionCostUsd, remainingAfterUsd };
};

export interface ModelRecommendation {
  modelId: string;
  reason: string;
  /** Model rẻ hơn nhưng bị bỏ qua, kèm lý do — để người dùng biết mà cân nhắc. */
  skipped: { modelId: string; reason: string }[];
}

/**
 * Model rẻ nhất còn dùng được cho loại việc này.
 *
 * Bỏ qua model thuộc nhà cung cấp đang mất kết nối — chọn model rẻ nhất mà nhà
 * cung cấp đang chết thì không tiết kiệm được gì, chỉ đổi tiền lấy thời gian
 * chờ rồi vẫn phải chạy lại.
 */
export const recommendCheapestModel = (
  type: ModelType,
  options: { health?: ProviderHealth[]; preferredId?: string } = {},
): ModelRecommendation | null => {
  const health = options.health ?? getProviderHealth();
  const downProviders = new Set(
    health.filter((item) => item.status === 'down').map((item) => item.providerId),
  );

  const rates = getUsagePolicy();
  const candidates = getModels(type).filter((model) => model.isEnabled);
  if (!candidates.length) return null;

  const priceOf = (modelId: string): number => {
    const override = rates.modelRates?.[modelId];
    if (type === 'image') return override?.imagePerOutput ?? rates.rates.imagePerOutput;
    if (type === 'video') return override?.videoPerSecond ?? rates.rates.videoPerSecond;
    return override?.chatPerMillionCharacters ?? rates.rates.chatPerMillionCharacters;
  };

  const skipped: ModelRecommendation['skipped'] = [];
  const usable = candidates.filter((model) => {
    if (downProviders.has(model.providerId)) {
      skipped.push({ modelId: model.id, reason: 'Nhà cung cấp đang mất kết nối' });
      return false;
    }
    return true;
  });

  const pool = usable.length ? usable : candidates;
  const cheapest = [...pool].sort((left, right) => priceOf(left.id) - priceOf(right.id))[0];

  if (options.preferredId && options.preferredId === cheapest.id) {
    return { modelId: cheapest.id, reason: 'Model bạn đang chọn cũng là model rẻ nhất còn chạy được.', skipped };
  }

  return {
    modelId: cheapest.id,
    reason: usable.length
      ? `Rẻ nhất trong số model còn chạy được cho loại ${type}.`
      : `Mọi nhà cung cấp đều đang trục trặc; đây là lựa chọn rẻ nhất, vẫn nên thử.`,
    skipped,
  };
};

export interface DirectorBriefing {
  budget: BudgetSnapshot;
  memory: ClientMemory;
  providerHealth: ProviderHealth[];
  calibration: KindCalibration[];
  characters: ConsistencyReadiness[];
  /** Những điều Đạo diễn phải biết trước khi lập kế hoạch. */
  warnings: string[];
}

export interface BriefingSources {
  articles?: SavedArticle[];
  ledger?: PublishLedgerEntry[];
  health?: ProviderHealth[];
  calibration?: KindCalibration[];
  usageRecords?: ReturnType<typeof getUsageRecords>;
  ceilingUsd?: number;
}

export const buildDirectorBriefing = (
  project: ProjectState,
  sources: BriefingSources = {},
): DirectorBriefing => {
  const budget = computeBudget(project.id, sources.ceilingUsd, sources.usageRecords ?? getUsageRecords());
  const memory = buildClientMemory(sources.articles ?? [], {
    clientId: project.clientId,
    ledger: sources.ledger ?? [],
  });
  const providerHealth = sources.health ?? getProviderHealth();
  const calibration = sources.calibration ?? computeCalibration(readCalibrationRecords());
  const characters = (project.scriptData?.characters ?? []).map((character: Character) =>
    assessCharacterReadiness(character),
  );

  const warnings: string[] = [];

  if (budget.status === 'exceeded') {
    warnings.push(`Dự án đã vượt trần ngân sách (${budget.spentUsd}/${budget.ceilingUsd} USD).`);
  } else if (budget.status === 'warning') {
    warnings.push(`Đã tiêu ${Math.round((budget.usedRatio ?? 0) * 100)}% ngân sách, còn ${budget.remainingUsd} USD.`);
  }

  const down = providerHealth.filter((item) => item.status === 'down');
  if (down.length) {
    warnings.push(`Nhà cung cấp đang mất kết nối: ${down.map((item) => item.providerId).join(', ')}.`);
  }

  // Nhân vật thiếu ảnh là nguyên nhân sinh lại tốn kém nhất, nên nêu đích danh.
  const notReady = characters.filter((item) => item.gaps.length > 0);
  if (notReady.length) {
    warnings.push(
      `Chưa đủ điều kiện giữ nhất quán: ${notReady.map((item) => item.name).join(', ')}. Sinh hàng loạt lúc này dễ phải làm lại.`,
    );
  }

  const noisy = calibration.filter((item) => item.trust === 'noisy');
  if (noisy.length) {
    warnings.push(
      `Cảnh báo hay báo sai, đã hạ mức: ${noisy.map((item) => KIND_LABELS[item.kind]).join(', ')}.`,
    );
  }

  return { budget, memory, providerHealth, calibration, characters, warnings };
};

/**
 * Biến bản giao ban thành khối ngữ cảnh cho prompt của Đạo diễn.
 *
 * Đặt cảnh báo lên đầu: đó là thứ phải đọc trước khi nghĩ ra bất cứ gì, và nếu
 * nằm cuối thì bị chìm giữa các mục dài hơn.
 */
export const buildBriefingPromptContext = (briefing: DirectorBriefing): string => {
  const parts: string[] = [];

  if (briefing.warnings.length) {
    parts.push('CẢNH BÁO TRƯỚC KHI LẬP KẾ HOẠCH:');
    for (const warning of briefing.warnings) parts.push(`- ${warning}`);
    parts.push('');
  }

  parts.push('NGÂN SÁCH:');
  if (briefing.budget.status === 'unset') {
    parts.push(`- Chưa đặt trần. Đã tiêu ${briefing.budget.spentUsd} USD cho dự án này.`);
  } else {
    parts.push(
      `- Trần ${briefing.budget.ceilingUsd} USD, đã tiêu ${briefing.budget.spentUsd} USD, còn ${briefing.budget.remainingUsd} USD.`,
      '- Mọi kế hoạch phải nằm trong phần còn lại. Nêu rõ chi phí dự kiến của từng bước.',
    );
  }

  const ready = briefing.characters.filter((item) => item.gaps.length === 0);
  if (briefing.characters.length) {
    parts.push('', 'NHÂN VẬT:');
    for (const item of briefing.characters) {
      parts.push(
        `- ${item.name}: ${item.referenceCount} ảnh tham chiếu${item.locked ? ', đã khoá model' : ''}` +
          (item.gaps.length ? ` — còn thiếu: ${item.gaps.join(' ')}` : ' — sẵn sàng'),
      );
    }
    if (ready.length < briefing.characters.length) {
      parts.push('- Ưu tiên bổ sung ảnh tham chiếu trước khi sinh hàng loạt.');
    }
  }

  const memoryBlock = buildMemoryPromptContext(briefing.memory);
  if (memoryBlock) parts.push('', memoryBlock);

  return parts.join('\n');
};

/** Một dòng tóm tắt cho giao diện. */
export const describeBriefing = (briefing: DirectorBriefing): string => {
  if (briefing.warnings.length) {
    return `${briefing.warnings.length} điều cần biết trước khi lập kế hoạch.`;
  }
  if (briefing.budget.status !== 'unset') {
    return `Còn ${briefing.budget.remainingUsd} USD trong ngân sách. Không có cảnh báo nào.`;
  }
  return 'Không có cảnh báo nào.';
};
