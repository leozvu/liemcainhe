import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import { createDefaultBrandKit } from '../services/brandKitService';
import {
  assertAISupervisorCanRelease,
  createDefaultAISupervisorState,
  cancelSupervisorRepair,
  executeSupervisorRepair,
  getAISupervisorGate,
  getShotFullSignature,
  getSupervisorRepairPlan,
  getVisionInputs,
  queueSupervisorRepair,
  runLocalSupervisorAudit,
  updateAISupervisorPolicy,
} from '../services/aiSupervisorService';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

const fixture = (): ProjectState => {
  const project = createNewProjectState();
  project.scriptData = {
    title: 'TVC thử nghiệm', genre: 'Quảng cáo', logline: 'Ra mắt sản phẩm', characters: [
      { id: 'char_1', name: 'Linh', gender: 'Nữ', age: '28', personality: 'Tự tin', visualPrompt: 'Vietnamese woman, short black hair', variations: [] },
    ],
    scenes: [{ id: 'scene_1', location: 'Studio', time: 'Sáng', atmosphere: 'Sạch', visualPrompt: 'Minimal bright studio' }],
    storyParagraphs: [],
  };
  project.brandKitSnapshot = {
    ...createDefaultBrandKit(),
    mandatoryTerms: ['Egoric'],
    forbiddenTerms: ['giá rẻ nhất'],
    ctas: ['Đăng ký ngay'],
  };
  project.shots = [
    {
      id: 'shot_1', sceneId: 'scene_1', actionSummary: 'Linh giới thiệu sản phẩm.', dialogue: 'Đây là một câu thoại rất dài và chắc chắn không thể đọc trọn vẹn chỉ trong một giây.', cameraMovement: 'Dolly in', characters: ['char_1'],
      keyframes: [
        { id: 'shot_1_start', type: 'start', visualPrompt: 'Linh trong studio', imageUrl: 'data:image/png;base64,one', status: 'completed' },
        { id: 'shot_1_end', type: 'end', visualPrompt: 'Linh cầm sản phẩm', imageUrl: 'data:image/png;base64,two', status: 'completed' },
      ],
      interval: { id: 'interval_1', startKeyframeId: 'shot_1_start', endKeyframeId: 'shot_1_end', duration: 1, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,one', status: 'completed' },
    },
    {
      id: 'shot_2', sceneId: 'scene_1', actionSummary: 'Packshot kết thúc.', dialogue: 'Khám phá hôm nay.', cameraMovement: 'Tĩnh', characters: [],
      keyframes: [
        { id: 'shot_2_start', type: 'start', visualPrompt: 'Packshot', status: 'pending' },
        { id: 'shot_2_end', type: 'end', visualPrompt: 'Logo', status: 'pending' },
      ],
      interval: { id: 'interval_2', startKeyframeId: 'shot_2_start', endKeyframeId: 'shot_2_end', duration: 4, motionStrength: 0.5, status: 'pending' },
    },
  ];
  return project;
};

const cleanFixture = (): ProjectState => {
  const project = createNewProjectState();
  project.scriptData = {
    title: 'Shot đạt', genre: 'Quảng cáo', logline: 'Đầu ra sạch', characters: [],
    scenes: [{ id: 'scene_clean', location: 'Studio', time: 'Sáng', atmosphere: 'Sạch', visualPrompt: 'Bright studio' }],
    storyParagraphs: [],
  };
  project.shots = [{
    id: 'shot_clean', sceneId: 'scene_clean', actionSummary: 'Sản phẩm trong studio.', dialogue: '', cameraMovement: 'Tĩnh', characters: [],
    keyframes: [
      { id: 'clean_start', type: 'start', visualPrompt: 'Product start', imageUrl: 'data:image/png;base64,clean-start', status: 'completed' },
      { id: 'clean_end', type: 'end', visualPrompt: 'Product end', imageUrl: 'data:image/png;base64,clean-end', status: 'completed' },
    ],
    interval: { id: 'clean_interval', startKeyframeId: 'clean_start', endKeyframeId: 'clean_end', duration: 4, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,clean', status: 'completed' },
  }];
  return project;
};

describe('AI Supervisor', () => {
  it('quét local bắt lỗi thoại/media/brand nhưng vẫn cho nhân vật chạy bằng prompt khi không có reference', () => {
    const audited = runLocalSupervisorAudit(fixture());
    const first = audited.aiSupervisor?.reports.find((report) => report.shotId === 'shot_1');
    const second = audited.aiSupervisor?.reports.find((report) => report.shotId === 'shot_2');
    expect(first?.issues.some((issue) => issue.kind === 'dialogue-overrun')).toBe(true);
    expect(first?.issues.some((issue) => issue.title === 'Nhân vật thiếu nguồn hình ảnh')).toBe(false);
    expect(second?.issues.some((issue) => issue.kind === 'missing-media' && issue.severity === 'critical')).toBe(true);
    expect(second?.issues.some((issue) => issue.kind === 'cta')).toBe(true);
  });

  it('làm mất hiệu lực kết quả Vision cũ khi media của shot thay đổi', () => {
    let project = runLocalSupervisorAudit(fixture());
    const state = project.aiSupervisor!;
    const report = state.reports[0];
    project.aiSupervisor = {
      ...state,
      reports: [{
        ...report,
        visionStatus: 'complete',
        issues: [...report.issues, {
          id: 'vision_old', kind: 'hands', severity: 'warning', status: 'open', source: 'ai-vision', title: 'Tay lỗi', detail: 'Sáu ngón', repairTarget: 'keyframes', createdAt: 1, updatedAt: 1,
        }],
      }, ...state.reports.slice(1)],
    };
    project.shots[0].keyframes[0].imageUrl = 'data:image/png;base64,changed';
    const audited = runLocalSupervisorAudit(project);
    const next = audited.aiSupervisor!.reports[0];
    expect(next.mediaSignature).toBe(getShotFullSignature(audited, audited.shots[0]));
    expect(next.visionStatus).toBe('not-run');
    expect(next.issues.some((issue) => issue.source === 'ai-vision')).toBe(false);
  });

  it('giữ kết quả Vision khi media và Reference Pack không đổi', () => {
    let project = runLocalSupervisorAudit(cleanFixture());
    const report = project.aiSupervisor!.reports[0];
    project.aiSupervisor = {
      ...project.aiSupervisor!,
      reports: [{
        ...report,
        visionStatus: 'complete',
        visionAnalyzedAt: 123,
        mediaSignature: getShotFullSignature(project, project.shots[0]),
        issues: [...report.issues, {
          id: 'vision_current', kind: 'hands', severity: 'warning', status: 'open', source: 'ai-vision', title: 'Tay cần duyệt', detail: 'Dấu hiệu bất thường', repairTarget: 'keyframes', frameTargets: ['end'], createdAt: 1, updatedAt: 1,
        }],
      }],
    };
    const audited = runLocalSupervisorAudit(project);
    expect(audited.aiSupervisor!.reports[0].visionStatus).toBe('complete');
    expect(audited.aiSupervisor!.reports[0].issues.some((issue) => issue.id === 'vision_current')).toBe(true);
  });

  it('chỉ gửi asset đã khóa trong Reference Pack sang Vision', () => {
    const project = cleanFixture();
    project.brandKitSnapshot = {
      ...createDefaultBrandKit(),
      assets: [
        { id: 'product_old', type: 'product', name: 'SKU cũ', url: 'data:image/png;base64,old' },
        { id: 'product_locked', type: 'product', name: 'SKU chuẩn', url: 'data:image/png;base64,locked', notes: 'Đúng nhãn xanh' },
      ],
    };
    project.consistency = { lockedBrandAssetIds: ['product_locked'], updatedAt: 1 };
    const inputs = getVisionInputs(project, project.shots[0]);
    expect(inputs.labels.some((label) => label.includes('SKU chuẩn'))).toBe(true);
    expect(inputs.labels.some((label) => label.includes('SKU cũ'))).toBe(false);
    expect(inputs.context.join(' ')).toContain('Đúng nhãn xanh');
  });

  it('chỉ xếp đúng shot lỗi, tạo checkpoint và chưa chạy API', () => {
    const audited = runLocalSupervisorAudit(fixture());
    const next = queueSupervisorRepair(audited, 'shot_2');
    expect(next.shots[0].workflow?.videoStale).not.toBe(true);
    expect(next.shots[1].workflow?.videoStale).toBe(true);
    expect(next.workflow?.jobs[0].kind).toBe('ai-supervisor');
    expect(next.workflow?.jobs[0].resourceId).toBe('shot_2');
    expect(next.workflow?.jobs[0].detail).toContain('chưa gọi API');
    expect(next.workflow?.checkpoints[0].label).toContain('Supervisor');
  });

  it('chặn xếp sửa khi dự toán vượt ngân sách còn lại', () => {
    const project = fixture();
    project.aiSupervisor = { ...createDefaultAISupervisorState(), policy: { ...createDefaultAISupervisorState().policy, repairBudgetUsd: 0.001 } };
    const audited = runLocalSupervisorAudit(project);
    expect(() => queueSupervisorRepair(audited, 'shot_2')).toThrow('vượt ngân sách');
  });

  it('lập kế hoạch chỉ tạo lại khung bị Vision chỉ định rồi dựng lại video', () => {
    let project = runLocalSupervisorAudit(cleanFixture());
    const report = project.aiSupervisor!.reports[0];
    project.aiSupervisor = {
      ...project.aiSupervisor!,
      reports: [{
        ...report,
        issues: [{
          id: 'vision_end', kind: 'hands', severity: 'critical', status: 'open', source: 'ai-vision', title: 'Lỗi tay khung cuối', detail: 'Khung cuối có sáu ngón', repairTarget: 'keyframes', frameTargets: ['end'], confidence: 0.96, createdAt: 1, updatedAt: 1,
        }],
      }],
    };
    const plan = getSupervisorRepairPlan(project, 'shot_clean');
    expect(plan.frameTargets).toEqual(['end']);
    expect(plan.actions.map((action) => action.tool)).toEqual(['generate-end-keyframe', 'generate-video']);
  });

  it('không xếp API cho lỗi thoại cần producer sửa nội dung', () => {
    const project = fixture();
    project.shots = [project.shots[0]];
    project.brandKitSnapshot = createDefaultBrandKit();
    const audited = runLocalSupervisorAudit(project);
    const dialogue = audited.aiSupervisor!.reports[0].issues.find((issue) => issue.kind === 'dialogue-overrun');
    expect(dialogue?.repairTarget).toBe('script');
    expect(() => queueSupervisorRepair(audited, 'shot_1')).toThrow('chỉnh thủ công');
  });

  it('hủy hàng sửa sẽ mở lại lỗi và hoàn ngân sách cam kết', () => {
    const audited = runLocalSupervisorAudit(fixture());
    const queued = queueSupervisorRepair(audited, 'shot_2');
    expect(queued.aiSupervisor!.repairCommittedCostUsd).toBeGreaterThan(0);
    const cancelled = cancelSupervisorRepair(queued, 'shot_2');
    expect(cancelled.aiSupervisor!.repairCommittedCostUsd).toBe(0);
    expect(cancelled.aiSupervisor!.reports.find((report) => report.shotId === 'shot_2')!.issues.some((issue) => issue.status === 'queued')).toBe(false);
    expect(cancelled.workflow!.jobs.find((job) => job.kind === 'ai-supervisor')!.status).toBe('cancelled');
  });

  it('entry point thực thi đúng kế hoạch đã xếp và hoàn tất production job', async () => {
    const queued = queueSupervisorRepair(runLocalSupervisorAudit(fixture()), 'shot_2');
    const called: string[] = [];
    const completed = await executeSupervisorRepair(queued, 'shot_2', {
      executeAction: async (current, action) => {
        called.push(action.tool);
        return {
          ...current,
          shots: current.shots.map((shot) => shot.id !== 'shot_2' ? shot : {
            ...shot,
            keyframes: shot.keyframes.map((frame) => action.tool === 'generate-start-keyframe' && frame.type === 'start'
              ? { ...frame, imageUrl: 'data:image/png;base64,repaired', status: 'completed' as const }
              : frame),
            interval: action.tool === 'generate-video'
              ? { ...shot.interval!, videoUrl: 'data:video/mp4;base64,repaired', status: 'completed' as const }
              : shot.interval,
            workflow: { ...shot.workflow, keyframesStale: false, videoStale: false },
          }),
        };
      },
    });
    expect(called).toEqual(['generate-start-keyframe', 'generate-video']);
    expect(completed.shots[1].keyframes[0].imageUrl).toContain('repaired');
    expect(completed.shots[1].interval?.videoUrl).toContain('repaired');
    expect(completed.workflow!.jobs.find((job) => job.kind === 'ai-supervisor')!.status).toBe('completed');
    expect(completed.aiSupervisor!.reports.find((report) => report.shotId === 'shot_2')!.issues.some((issue) => issue.status === 'queued')).toBe(false);
  });

  it('release gate chặn báo cáo cũ và Vision bắt buộc, nhưng cho qua dự án sạch', () => {
    const initial = cleanFixture();
    expect(getAISupervisorGate(initial).status).toBe('blocked');
    expect(() => assertAISupervisorCanRelease(initial)).toThrow('đang khóa đầu ra');
    let audited = runLocalSupervisorAudit(initial);
    expect(getAISupervisorGate(audited).status).toBe('ready');
    expect(assertAISupervisorCanRelease(audited).canRelease).toBe(true);
    audited = updateAISupervisorPolicy(audited, { ...audited.aiSupervisor!.policy, requireVisionForRelease: true });
    expect(getAISupervisorGate(audited).reasons.join(' ')).toContain('chưa qua AI Vision');
    const report = audited.aiSupervisor!.reports[0];
    audited.aiSupervisor = { ...audited.aiSupervisor!, reports: [{ ...report, visionStatus: 'complete', visionAnalyzedAt: Date.now() }] };
    expect(getAISupervisorGate(audited).status).toBe('ready');
  });

  it('chuẩn hóa ngưỡng Vision để ngưỡng chặn không thấp hơn ngưỡng lọc', () => {
    const project = updateAISupervisorPolicy(cleanFixture(), {
      ...createDefaultAISupervisorState().policy,
      minimumVisionConfidence: 0.91,
      criticalVisionConfidence: 0.4,
    });
    expect(project.aiSupervisor!.policy.minimumVisionConfidence).toBe(0.91);
    expect(project.aiSupervisor!.policy.criticalVisionConfidence).toBe(0.91);
  });
});
