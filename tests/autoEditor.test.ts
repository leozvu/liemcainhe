import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import {
  buildAutoEditorSrt,
  createAutoEditorPlan,
  finishAutoEditorRender,
  getAutoEditorPreflight,
  getAutoEditorSummary,
  startAutoEditorRender,
  updateAutoEditorSettings,
} from '../services/autoEditorService';

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
  project.title = 'Chiến dịch Egoric';
  project.brandKitSnapshot = {
    colors: [], fonts: [], toneOfVoice: 'Tinh gọn', mandatoryTerms: [], forbiddenTerms: [], ctas: [], approvedExamples: [], platformRules: [], updatedAt: 1,
    assets: [{ id: 'logo_1', type: 'logo', name: 'Logo chính', url: 'data:image/png;base64,logo' }],
  };
  project.shots = [
    {
      id: 'shot_1', sceneId: 'scene_1', actionSummary: 'Mở đầu sản phẩm.', dialogue: 'Một giải pháp mới dành cho đội ngũ marketing Việt Nam.', cameraMovement: 'Dolly in', characters: [],
      keyframes: [],
      interval: { id: 'int_1', startKeyframeId: 'a', endKeyframeId: 'b', duration: 5, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,one', status: 'completed' },
    },
    {
      id: 'shot_2', sceneId: 'scene_1', actionSummary: 'Packshot và CTA.', dialogue: 'Bắt đầu cùng Egoric ngay hôm nay.', cameraMovement: 'Tĩnh', characters: [],
      keyframes: [],
      interval: { id: 'int_2', startKeyframeId: 'c', endKeyframeId: 'd', duration: 4, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,two', status: 'completed' },
    },
  ];
  project.creativeDirector = {
    mode: 'advisory', budgetLimitUsd: 10, messages: [], proposals: [], runs: [], missions: [], plan: [], memory: [],
    timeline: [
      { shotId: 'shot_2', duration: 4, transition: 'cut', editNote: 'CTA' },
      { shotId: 'shot_1', duration: 5, transition: 'cut', editNote: 'Hook' },
    ],
  };
  project.voiceStudio = {
    defaultProviderId: 'elevenlabs', profiles: [], outputFormat: 'mp3', normalizeLoudness: true, pronunciationDictionary: [], previewText: '',
    selectedTakeByShot: { shot_1: 'take_1' },
    takes: [{ id: 'take_1', shotId: 'shot_1', text: project.shots[0].dialogue!, source: 'synthetic', providerId: 'elevenlabs', status: 'ready', audioUrl: 'data:audio/mpeg;base64,voice', createdAt: 1 }],
  };
  return project;
};

describe('Auto Editor', () => {
  it('lập timeline theo đạo diễn, tạo caption và nhiều đầu ra mà không gọi API', () => {
    let project = fixture();
    project = updateAutoEditorSettings(project, { aspectRatios: ['9:16', '1:1', '16:9'] });
    const planned = createAutoEditorPlan(project);
    expect(planned.autoEditor?.timeline.map((clip) => clip.shotId)).toEqual(['shot_2', 'shot_1']);
    expect(planned.autoEditor?.captions.length).toBeGreaterThanOrEqual(2);
    expect(planned.autoEditor?.outputs).toHaveLength(3);
    expect(planned.workflow?.jobs[0].kind).toBe('auto-editor');
    expect(planned.workflow?.jobs[0].status).toBe('completed');
    expect(planned.workflow?.jobs[0].detail).toContain('không gọi API');
    expect(buildAutoEditorSrt(planned)).toContain('00:00:00,000');
  });

  it('preflight chặn video hoặc logo thiếu và chỉ cảnh báo voice thiếu', () => {
    let project = fixture();
    project.shots[1].interval!.videoUrl = undefined;
    project.brandKitSnapshot!.assets = [];
    project = updateAutoEditorSettings(project, { logoEnabled: true });
    const planned = createAutoEditorPlan(project);
    const issues = getAutoEditorPreflight(planned);
    expect(issues.some((issue) => issue.id === 'video-shot_2' && issue.severity === 'blocked')).toBe(true);
    expect(issues.some((issue) => issue.id === 'logo' && issue.severity === 'blocked')).toBe(true);
    expect(issues.some((issue) => issue.id === 'voice-shot_2' && issue.severity === 'warning')).toBe(true);
  });

  it('đánh dấu timeline cũ khi media hoặc cấu hình thay đổi', () => {
    const planned = createAutoEditorPlan(fixture());
    expect(getAutoEditorSummary(planned).stale).toBe(false);
    const changedSettings = updateAutoEditorSettings(planned, { colorPreset: 'cinematic' });
    expect(getAutoEditorSummary(changedSettings).stale).toBe(true);
    const changedMedia = createAutoEditorPlan(planned);
    changedMedia.shots[0].interval!.videoUrl = 'data:video/mp4;base64,changed';
    expect(getAutoEditorSummary(changedMedia).stale).toBe(true);
  });

  it('tạo checkpoint và job render cục bộ rồi hoàn tất đúng đầu ra', () => {
    const planned = createAutoEditorPlan(fixture());
    const output = planned.autoEditor!.outputs[0];
    const started = startAutoEditorRender(planned, output.id);
    expect(started.autoEditor?.outputs[0].status).toBe('rendering');
    expect(started.workflow?.checkpoints[0].label).toContain('render');
    expect(started.workflow?.jobs[0].kind).toBe('auto-editor');
    expect(started.workflow?.jobs[0].detail).toContain('không gọi API');
    const finished = finishAutoEditorRender(started, output.id);
    expect(finished.autoEditor?.outputs[0].status).toBe('ready');
    expect(finished.workflow?.jobs[0].status).toBe('completed');
  });
});
