import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import {
  approveVideoFactoryVariant,
  createDefaultVideoFactoryState,
  createVideoFactoryPlan,
  materializeVideoFactoryVariant,
  removeVideoFactoryVariant,
} from '../services/videoFactoryService';

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

const projectFixture = (): ProjectState => {
  const project = createNewProjectState();
  project.shots = [
    {
      id: 'shot_1', sceneId: 'scene_1', actionSummary: 'Nhân vật mở hộp sản phẩm.', dialogue: 'Bắt đầu một ngày mới.', cameraMovement: 'Dolly in', characters: ['char_1'],
      keyframes: [
        { id: 'shot_1_start', type: 'start', visualPrompt: 'Hộp đóng', imageUrl: 'data:image/png;base64,start', status: 'completed' },
        { id: 'shot_1_end', type: 'end', visualPrompt: 'Hộp mở', imageUrl: 'data:image/png;base64,end', status: 'completed' },
      ],
      interval: { id: 'interval_1', startKeyframeId: 'shot_1_start', endKeyframeId: 'shot_1_end', duration: 8, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,one', status: 'completed' },
    },
    {
      id: 'shot_2', sceneId: 'scene_1', actionSummary: 'Packshot kết thúc.', dialogue: 'Khám phá ngay.', cameraMovement: 'Tĩnh', characters: [],
      keyframes: [
        { id: 'shot_2_start', type: 'start', visualPrompt: 'Packshot', status: 'pending' },
        { id: 'shot_2_end', type: 'end', visualPrompt: 'Logo', status: 'pending' },
      ],
      interval: { id: 'interval_2', startKeyframeId: 'shot_2_start', endKeyframeId: 'shot_2_end', duration: 4, motionStrength: 0.5, status: 'pending' },
    },
  ];
  project.videoFactory = createDefaultVideoFactoryState();
  return project;
};

const plan = (project: ProjectState, budgetLimitUsd = 100) => createVideoFactoryPlan(project, {
  hooks: ['Hook A', 'Hook B', 'Hook C', 'Hook D', 'Hook E'],
  ctas: ['CTA A', 'CTA B', 'CTA C'],
  aspectRatios: ['9:16', '1:1', '16:9'],
  durations: [15, 30, 45],
  voiceModes: ['with-voice', 'no-voice'],
  audiences: ['Gen Z', 'Gia đình trẻ'],
  policy: { ...project.videoFactory!.policy, maxVariants: 12, budgetLimitUsd, reuseAssets: true },
});

describe('Video Factory', () => {
  it('lấy mẫu ma trận lớn theo giới hạn và chưa tạo shot/API', () => {
    const project = projectFixture();
    const next = plan(project);
    expect(next.videoFactory?.variants).toHaveLength(12);
    expect(next.shots).toHaveLength(2);
    expect(next.videoFactory?.variants.every((variant) => variant.status === 'planned')).toBe(true);
    expect(new Set(next.videoFactory?.variants.map((variant) => variant.aspectRatio)).size).toBeGreaterThan(1);
  });

  it('materialize một biến thể, giữ asset ids và không giữ media output cũ', () => {
    const planned = plan(projectFixture());
    const variant = planned.videoFactory!.variants[0];
    const next = materializeVideoFactoryVariant(planned, variant.id);
    const clones = next.shots.filter((shot) => shot.factory?.variantId === variant.id);
    expect(clones).toHaveLength(2);
    expect(clones[0].characters).toEqual(['char_1']);
    expect(clones[0].keyframes.every((frame) => !frame.imageUrl)).toBe(true);
    expect(clones.every((shot) => !shot.interval?.videoUrl)).toBe(true);
    expect(clones.reduce((sum, shot) => sum + Number(shot.interval?.duration || 0), 0)).toBe(variant.duration);
    expect(next.workflow?.jobs[0].kind).toBe('video-factory');
    expect(next.workflow?.jobs[0].detail).toContain('Chưa gọi API');
  });

  it('chỉ nâng model final sau thao tác duyệt và tạo checkpoint', () => {
    const planned = plan(projectFixture());
    const variant = planned.videoFactory!.variants[0];
    const drafted = materializeVideoFactoryVariant(planned, variant.id);
    const approved = approveVideoFactoryVariant(drafted, variant.id);
    expect(approved.videoFactory?.variants.find((item) => item.id === variant.id)?.tier).toBe('final');
    expect(approved.videoFactory?.variants.find((item) => item.id === variant.id)?.status).toBe('approved');
    expect(approved.shots.filter((shot) => shot.factory?.variantId === variant.id).every((shot) => shot.factory?.tier === 'final')).toBe(true);
    expect(approved.workflow?.checkpoints[0].label).toContain('model final');
  });

  it('chặn materialize khi vượt ngân sách và xóa sạch shot của biến thể', () => {
    const lowBudget = plan(projectFixture(), 0.01);
    const variant = lowBudget.videoFactory!.variants[0];
    expect(() => materializeVideoFactoryVariant(lowBudget, variant.id)).toThrow('vượt trần');

    const normal = plan(projectFixture(), 100);
    const normalVariant = normal.videoFactory!.variants[0];
    const drafted = materializeVideoFactoryVariant(normal, normalVariant.id);
    const removed = removeVideoFactoryVariant(drafted, normalVariant.id);
    expect(removed.videoFactory?.variants.some((item) => item.id === normalVariant.id)).toBe(false);
    expect(removed.shots.some((shot) => shot.factory?.variantId === normalVariant.id)).toBe(false);
  });
});

