import { describe, expect, it } from 'vitest';
import {
  BUDGET_WARNING_RATIO,
  buildBriefingPromptContext,
  buildDirectorBriefing,
  checkMissionBudget,
  computeBudget,
  describeBriefing,
} from '../services/directorBriefingService';
import { computeCalibration } from '../services/supervisorCalibrationService';
import { computeProviderHealth } from '../services/providerHealthService';
import { lockGenerationParams } from '../services/consistencyService';
import { localizeApiErrorMessage } from '../services/apiErrorLocalization';
import { createDefaultBrief } from '../services/content/contentAxes';
import { UsageRecord } from '../services/usageService';
import { ProjectState } from '../types';
import { SavedArticle } from '../types/content';

const usage = (cost: number, projectId = 'p1', i = 0): UsageRecord => ({
  id: `u${i}`,
  timestamp: i,
  projectId,
  kind: 'video',
  units: 1,
  estimatedCostUsd: cost,
  status: 'success',
});

const project = (over: Partial<ProjectState> = {}): ProjectState =>
  ({
    id: 'p1',
    title: 'Dự án',
    clientId: 'c1',
    shots: [],
    scriptData: {
      title: 'x', genre: 'y', logline: 'z',
      characters: [
        { id: 'ch1', name: 'Hạnh', gender: 'nữ', age: '32', personality: 'điềm đạm', variations: [] },
      ],
      scenes: [],
      storyParagraphs: [],
    },
    ...over,
  }) as ProjectState;

describe('tính ngân sách từ tiền đã tiêu thật', () => {
  it('cộng đúng chi phí của dự án, bỏ qua dự án khác', () => {
    const budget = computeBudget('p1', 100, [usage(10, 'p1', 1), usage(5, 'p2', 2), usage(3, 'p1', 3)]);
    expect(budget.spentUsd).toBe(13);
    expect(budget.remainingUsd).toBe(87);
    expect(budget.status).toBe('ok');
  });

  it('chưa đặt trần thì không phán xét', () => {
    const budget = computeBudget('p1', undefined, [usage(999, 'p1', 1)]);
    expect(budget.status).toBe('unset');
    expect(budget.usedRatio).toBeNull();
    expect(budget.remainingUsd).toBeUndefined();
  });

  it('cảnh báo khi gần chạm trần', () => {
    const budget = computeBudget('p1', 100, [usage(BUDGET_WARNING_RATIO * 100, 'p1', 1)]);
    expect(budget.status).toBe('warning');
  });

  it('vượt trần thì báo vượt', () => {
    expect(computeBudget('p1', 100, [usage(120, 'p1', 1)]).status).toBe('exceeded');
  });
});

describe('cổng ngân sách cho kế hoạch', () => {
  it('cho chạy khi còn đủ tiền', () => {
    const verdict = checkMissionBudget({ estimatedCostUsd: 20 }, computeBudget('p1', 100, [usage(10)]));
    expect(verdict.allowed).toBe(true);
    expect(verdict.remainingAfterUsd).toBe(70);
  });

  it('chặn khi kế hoạch tốn hơn phần còn lại, và nói thiếu bao nhiêu', () => {
    const verdict = checkMissionBudget({ estimatedCostUsd: 50 }, computeBudget('p1', 100, [usage(80)]));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Thiếu 30');
  });

  it('đã vượt trần thì chặn mọi kế hoạch, kể cả kế hoạch rẻ', () => {
    const verdict = checkMissionBudget({ estimatedCostUsd: 0.01 }, computeBudget('p1', 100, [usage(150)]));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('vượt trần');
  });

  it('chưa đặt trần thì không cản — không áp luật khi người dùng chưa chọn luật', () => {
    expect(checkMissionBudget({ estimatedCostUsd: 9999 }, computeBudget('p1', undefined, [])).allowed).toBe(true);
  });
});

describe('bản giao ban gộp kết quả của bốn epic trước', () => {
  const article = (over: Partial<SavedArticle> = {}): SavedArticle => ({
    id: 'a1', title: 'Bài đã duyệt', createdAt: 1, updatedAt: 1, clientId: 'c1',
    brief: createDefaultBrief('Chủ đề'),
    draft: { title: 'Bài đã duyệt', sapo: 'Mở bài.', sections: [{ heading: 'A', body: 'Nội dung.' }], hashtags: [], seoTitle: 'x', metaDescription: 'y', readingMinutes: 1 },
    review: {
      schemaVersion: 2,
      decision: 'approved',
      mode: 'individual',
      role: 'account',
      opened: true,
      artifactVersion: 'article-a1-v1',
      gate: 'content-internal',
    },
    ...over,
  });

  const downHealth = computeProviderHealth(
    Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, timestamp: 1000 - i, providerId: 'openrouter', kind: 'video' as const,
      units: 1, estimatedCostUsd: 0, status: 'failed' as const,
      error: localizeApiErrorMessage('', 503),
    })),
    1000,
  );

  const noisyCalibration = computeCalibration(
    Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`, kind: 'hands' as const, source: 'ai-vision' as const, severity: 'critical' as const,
      outcome: i < 8 ? ('overridden' as const) : ('accepted' as const), timestamp: i,
    })),
  );

  it('nêu cảnh báo ngân sách, nhà cung cấp chết, nhân vật thiếu ảnh và cảnh báo mất tín', () => {
    const briefing = buildDirectorBriefing(project(), {
      ceilingUsd: 100,
      usageRecords: [usage(95)],
      articles: [article()],
      health: downHealth,
      calibration: noisyCalibration,
    });

    const all = briefing.warnings.join(' ');
    expect(all).toContain('ngân sách');
    expect(all).toContain('openrouter');
    expect(all).toContain('Hạnh');
    expect(all).toContain('Bàn tay');
  });

  it('mọi thứ ổn thì không bịa cảnh báo', () => {
    const p = project();
    p.scriptData!.characters[0] = lockGenerationParams(
      {
        ...p.scriptData!.characters[0],
        referencePack: [
          { id: 'r1', imageUrl: 'a', angle: 'front', approved: true, addedAt: 1 },
          { id: 'r2', imageUrl: 'b', angle: 'three-quarter', approved: true, addedAt: 2 },
        ],
      },
      { modelId: 'kie-veo3' },
    );

    const briefing = buildDirectorBriefing(p, {
      ceilingUsd: 100,
      usageRecords: [usage(5)],
      articles: [],
      health: [],
      calibration: [],
    });

    expect(briefing.warnings).toEqual([]);
    expect(describeBriefing(briefing)).toContain('Không có cảnh báo');
  });

  it('mang theo trí nhớ khách hàng từ Epic 2', () => {
    const briefing = buildDirectorBriefing(project(), {
      articles: [article()],
      health: [],
      calibration: [],
      usageRecords: [],
    });
    expect(briefing.memory.approvedCount).toBe(1);
  });
});

describe('khối ngữ cảnh cho prompt của Đạo diễn', () => {
  it('cảnh báo đứng đầu, trước cả ngân sách', () => {
    const text = buildBriefingPromptContext(
      buildDirectorBriefing(project(), {
        ceilingUsd: 100,
        usageRecords: [usage(95)],
        articles: [],
        health: [],
        calibration: [],
      }),
    );
    expect(text.indexOf('CẢNH BÁO')).toBeLessThan(text.indexOf('NGÂN SÁCH'));
  });

  it('nêu rõ còn bao nhiêu tiền và buộc kế hoạch nằm trong đó', () => {
    const text = buildBriefingPromptContext(
      buildDirectorBriefing(project(), {
        ceilingUsd: 100,
        usageRecords: [usage(20)],
        articles: [],
        health: [],
        calibration: [],
      }),
    );
    expect(text).toContain('còn 80 USD');
    expect(text).toContain('phải nằm trong phần còn lại');
  });

  it('liệt kê nhân vật kèm thứ còn thiếu', () => {
    const text = buildBriefingPromptContext(
      buildDirectorBriefing(project(), { articles: [], health: [], calibration: [], usageRecords: [] }),
    );
    expect(text).toContain('Hạnh');
    expect(text).toContain('còn thiếu');
  });

  it('chưa đặt trần thì nói rõ là chưa đặt, không giả vờ có', () => {
    const text = buildBriefingPromptContext(
      buildDirectorBriefing(project(), { articles: [], health: [], calibration: [], usageRecords: [usage(7)] }),
    );
    expect(text).toContain('Chưa đặt trần');
    expect(text).toContain('7 USD');
  });
});
