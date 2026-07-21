import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import { createDefaultBrandKit } from '../services/brandKitService';
import {
  createDefaultAISupervisorState,
  getShotMediaSignature,
  queueSupervisorRepair,
  runLocalSupervisorAudit,
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
    expect(next.mediaSignature).toBe(getShotMediaSignature(project.shots[0]));
    expect(next.visionStatus).toBe('not-run');
    expect(next.issues.some((issue) => issue.source === 'ai-vision')).toBe(false);
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
});
