import { ProjectState } from '../types';
import { MOCK_SCRIPT, MOCK_SHOTS } from './mockData';
import { createDefaultVoiceStudioState } from './storageService';
import { createDefaultWorkflowState } from './workflowService';

export const createProductionDemoProject = (): ProjectState => {
  const now = Date.now();
  const shots = MOCK_SHOTS.map((shot, index) => ({
    ...structuredClone(shot),
    id: `demo_shot_${index + 1}`,
    dialogue: index === 0
      ? 'Thành phố này không ngủ. Nó chỉ đổi giấc mơ thành dữ liệu.'
      : 'Vậy thì ta phải đánh thức những người còn nhớ mình là ai.',
    keyframes: shot.keyframes.map((keyframe, keyframeIndex) => ({
      ...keyframe,
      id: `demo_kf_${index + 1}_${keyframeIndex + 1}`,
      imageUrl: undefined,
      status: 'pending' as const,
    })),
    interval: shot.interval ? {
      ...shot.interval,
      id: `demo_interval_${index + 1}`,
      startKeyframeId: `demo_kf_${index + 1}_1`,
      endKeyframeId: `demo_kf_${index + 1}_2`,
      videoUrl: undefined,
      status: 'pending' as const,
    } : undefined,
    workflow: { keyframesStale: true, voiceStale: true, videoStale: true, updatedAt: now },
  }));
  return {
    id: `egoric_demo_${now.toString(36)}`,
    title: 'Demo sản xuất · Mưa Neon',
    createdAt: now,
    lastModified: now,
    stage: 'script',
    rawScript: `TÊN: MƯA NEON\n\nCẢNH 1 — NGÕ KHU 7, ĐÊM\nMinh đứng dưới mưa và nhìn lên bảng quảng cáo ba chiều. Linh bước ra khỏi làn hơi nước.\n\nMINH\nThành phố này không ngủ. Nó chỉ đổi giấc mơ thành dữ liệu.\n\nLINH\nVậy thì ta phải đánh thức những người còn nhớ mình là ai.`,
    targetDuration: '30s',
    language: 'Vietnamese',
    visualStyle: 'live-action cinematic neon noir',
    shotGenerationModel: 'openrouter-auto',
    scriptData: { ...structuredClone(MOCK_SCRIPT), targetDuration: '30s', language: 'Vietnamese', visualStyle: 'live-action cinematic neon noir', shotGenerationModel: 'openrouter-auto' },
    shots,
    isParsingScript: false,
    renderLogs: [],
    voiceStudio: createDefaultVoiceStudioState(),
    workflow: createDefaultWorkflowState(),
  };
};
