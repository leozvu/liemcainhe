import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectState } from '../types';
import { createDefaultCreativeDirectorState, normalizeCreativeDirectorState } from '../services/creativeDirectorState';
import {
  applyCreativeDirectorProposal,
  beginCreativeDirectorRun,
  completeCreativeDirectorRun,
  estimateRemainingProductionCost,
  inferCreativeDirectorToolRequest,
  sanitizeCreativeDirectorToolRequest,
} from '../services/creativeDirectorService';
import { createDefaultWorkflowState, normalizeWorkflowState } from '../services/workflowService';
import {
  createCreativeDirectorMission,
  startCreativeDirectorMission,
} from '../services/creativeDirectorMissionService';

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

const projectFixture = (): ProjectState => ({
  id: 'proj_test',
  title: 'Phim thử nghiệm',
  createdAt: 1,
  lastModified: 1,
  stage: 'script',
  rawScript: 'Một nhân vật bước vào căn phòng.',
  targetDuration: '30s',
  language: 'Vietnamese',
  visualStyle: 'live-action',
  shotGenerationModel: 'openrouter-auto',
  scriptData: {
    title: 'Phim thử nghiệm',
    genre: 'Tâm lý',
    logline: 'Một quyết định trong căn phòng kín.',
    characters: [{
      id: 'char_1',
      name: 'An',
      gender: 'Nữ',
      age: '28',
      personality: 'Điềm tĩnh',
      variations: [],
    }],
    scenes: [{
      id: 'scene_1',
      location: 'Căn phòng',
      time: 'Đêm',
      atmosphere: 'Căng thẳng',
    }],
    storyParagraphs: [],
  },
  shots: [],
  isParsingScript: false,
  renderLogs: [],
  workflow: createDefaultWorkflowState(),
  creativeDirector: createDefaultCreativeDirectorState(),
});

describe('Đạo diễn AI', () => {
  it('khôi phục trạng thái mặc định cho dự án cũ', () => {
    const state = normalizeCreativeDirectorState(undefined);
    expect(state.mode).toBe('copilot');
    expect(state.messages[0].content).toContain('Đạo diễn AI');
    expect(state.budgetLimitUsd).toBeGreaterThan(0);
  });

  it('áp dụng storyboard qua checkpoint và ánh xạ tên nhân vật sang id', () => {
    const project = projectFixture();
    project.creativeDirector!.proposals = [{
      id: 'proposal_storyboard',
      kind: 'storyboard',
      title: 'Storyboard 2 cảnh',
      summary: 'Tạo nhịp mở và kết.',
      rationale: ['Rõ nhịp kể'],
      affectedShotIds: [],
      estimatedCostUsd: 0,
      requiresApproval: true,
      status: 'pending',
      createdAt: 2,
      changes: {
        shots: [{
          sceneId: 'scene_1',
          actionSummary: 'An mở cửa và dừng lại.',
          cameraMovement: 'Dolly in chậm',
          shotSize: 'Trung cảnh',
          characters: ['An'],
          duration: 6,
        }],
      },
    }];

    const next = applyCreativeDirectorProposal(project, 'proposal_storyboard');
    expect(next.workflow?.checkpoints).toHaveLength(1);
    expect(next.shots).toHaveLength(1);
    expect(next.shots[0].characters).toEqual(['char_1']);
    expect(next.shots[0].interval?.duration).toBe(6);
    expect(next.creativeDirector?.proposals[0].status).toBe('applied');
  });

  it('ước tính phần media còn thiếu theo usage policy', () => {
    const project = projectFixture();
    project.shots = [{
      id: 'shot_1',
      sceneId: 'scene_1',
      actionSummary: 'An nói.',
      dialogue: 'Chúng ta bắt đầu thôi.',
      cameraMovement: 'Tĩnh',
      characters: ['char_1'],
      keyframes: [],
      interval: {
        id: 'interval_1',
        startKeyframeId: 'start',
        endKeyframeId: 'end',
        duration: 8,
        motionStrength: 0.5,
        status: 'pending',
      },
    }];

    const estimate = estimateRemainingProductionCost(project);
    expect(estimate.missingImages).toBe(2);
    expect(estimate.missingVideos).toBe(1);
    expect(estimate.videoSeconds).toBe(8);
    expect(estimate.voiceCharacters).toBeGreaterThan(0);
    expect(estimate.totalUsd).toBeGreaterThan(0);
  });

  it('lập DAG asset → keyframe → video và không gọi trùng đầu ra đã có', () => {
    const project = projectFixture();
    project.shots = [{
      id: 'shot_1',
      sceneId: 'scene_1',
      actionSummary: 'An bước vào phòng.',
      cameraMovement: 'Dolly in',
      characters: ['char_1'],
      keyframes: [],
    }];

    const { mission } = createCreativeDirectorMission(project);
    expect(mission.actions).toHaveLength(5);
    const assetActions = mission.actions.filter((action) => action.stage === 'assets');
    const frameActions = mission.actions.filter((action) => action.tool.includes('keyframe'));
    const videoAction = mission.actions.find((action) => action.tool === 'generate-video');
    expect(assetActions).toHaveLength(2);
    expect(frameActions.every((action) => action.dependsOn.length === 2)).toBe(true);
    expect(videoAction?.dependsOn).toEqual(frameActions.map((action) => action.id));

    project.scriptData!.characters[0].referenceImage = 'data:image/png;base64,char';
    project.scriptData!.scenes[0].referenceImage = 'data:image/png;base64,scene';
    project.shots[0].keyframes = [
      { id: 'start', type: 'start', visualPrompt: 'start', imageUrl: 'data:image/png;base64,start', status: 'completed' },
      { id: 'end', type: 'end', visualPrompt: 'end', imageUrl: 'data:image/png;base64,end', status: 'completed' },
    ];
    project.shots[0].interval = {
      id: 'interval',
      startKeyframeId: 'start',
      endKeyframeId: 'end',
      duration: 8,
      motionStrength: 5,
      videoUrl: 'data:video/mp4;base64,video',
      status: 'completed',
    };
    project.shots[0].workflow = { keyframesStale: false, videoStale: false };
    expect(createCreativeDirectorMission(project).mission.actions).toHaveLength(0);
  });

  it('chỉ lập đúng tool được agent yêu cầu và tự kéo theo các phụ thuộc bắt buộc', () => {
    const project = projectFixture();
    project.shots = [{
      id: 'shot_video',
      sceneId: 'scene_1',
      actionSummary: 'An bước vào phòng.',
      dialogue: 'Xin chào.',
      cameraMovement: 'Dolly in',
      characters: ['char_1'],
      keyframes: [],
    }];

    const request = {
      goal: 'Dựng video cho cảnh mở đầu',
      tools: ['generate-video' as const],
      shotIds: ['shot_video'],
    };
    const { mission } = createCreativeDirectorMission(project, request.goal, request);
    expect(mission.actions.map((action) => action.tool)).toEqual([
      'generate-character-image',
      'generate-scene-image',
      'generate-start-keyframe',
      'generate-end-keyframe',
      'generate-video',
    ]);
    expect(mission.actions.some((action) => action.tool === 'generate-voice')).toBe(false);
    expect(mission.request).toEqual(request);
  });

  it('lọc toolRequest lạ trước khi đưa vào bộ thực thi', () => {
    expect(sanitizeCreativeDirectorToolRequest({
      goal: 'Tạo video',
      tools: ['generate-video', 'delete-project', 'generate-video'],
      shotIds: ['shot_1'],
    })).toEqual({ goal: 'Tạo video', tools: ['generate-video'], shotIds: ['shot_1'] });
    expect(sanitizeCreativeDirectorToolRequest({ tools: ['delete-project'] })).toBeUndefined();
  });

  it('có fallback cục bộ khi model quên trả toolRequest nhưng người dùng ra lệnh rõ ràng', () => {
    expect(inferCreativeDirectorToolRequest('Hãy dựng video cho dự án này')?.tools).toEqual(['generate-video']);
    expect(inferCreativeDirectorToolRequest('Giúp tôi tạo toàn bộ hình ảnh')?.tools).toEqual([
      'generate-character-image',
      'generate-scene-image',
      'generate-start-keyframe',
      'generate-end-keyframe',
    ]);
    expect(inferCreativeDirectorToolRequest('Tạo ảnh đi')?.tools).toHaveLength(4);
    expect(inferCreativeDirectorToolRequest('Làm sao để tạo video đẹp hơn?')).toBeUndefined();
    expect(inferCreativeDirectorToolRequest('Phản biện nhịp video hiện tại')).toBeUndefined();
  });

  it('nối toolRequest từ hội thoại thành nhiệm vụ có thể duyệt và chạy', () => {
    const started = beginCreativeDirectorRun(projectFixture(), 'Tạo video cho dự án');
    const next = completeCreativeDirectorRun(started.project, started.run.id, {
      message: 'Tôi đã chuẩn bị chuỗi công cụ cần thiết.',
      diagnosis: [],
      plan: [],
      toolRequest: {
        goal: 'Tạo video cho dự án',
        tools: ['generate-video'],
        shotIds: [],
      },
      memory: [],
      suggestedReplies: [],
    });
    const director = normalizeCreativeDirectorState(next.creativeDirector);
    const run = director.runs.find((item) => item.id === started.run.id);
    expect(run?.missionId).toBeTruthy();
    expect(director.messages.at(-1)?.missionId).toBe(run?.missionId);
    expect(director.missions.find((mission) => mission.id === run?.missionId)?.request?.tools).toEqual(['generate-video']);
  });

  it('chờ áp dụng storyboard rồi mới lập nhiệm vụ tool trên các shot mới', () => {
    const started = beginCreativeDirectorRun(projectFixture(), 'Tạo storyboard rồi dựng video');
    const toolRequest = { goal: 'Dựng cảnh mới', tools: ['generate-video' as const], shotIds: ['shot_new'] };
    const completed = completeCreativeDirectorRun(started.project, started.run.id, {
      message: 'Storyboard cần được duyệt trước khi dựng.',
      diagnosis: [],
      plan: [],
      proposal: {
        id: 'proposal_with_tool',
        kind: 'storyboard',
        title: 'Storyboard mới',
        summary: 'Một cảnh mở đầu.',
        rationale: [],
        affectedShotIds: ['shot_new'],
        estimatedCostUsd: 0,
        requiresApproval: true,
        status: 'pending',
        changes: {
          shots: [{
            id: 'shot_new',
            sceneId: 'scene_1',
            actionSummary: 'An bước vào phòng.',
            cameraMovement: 'Dolly in',
            characters: ['char_1'],
          }],
        },
        missionRequest: toolRequest,
        createdAt: 2,
      },
      toolRequest,
      memory: [],
      suggestedReplies: [],
    });
    expect(normalizeCreativeDirectorState(completed.creativeDirector).missions).toHaveLength(0);

    const applied = applyCreativeDirectorProposal(completed, 'proposal_with_tool');
    const director = normalizeCreativeDirectorState(applied.creativeDirector);
    const run = director.runs.find((item) => item.id === started.run.id);
    const mission = director.missions.find((item) => item.id === run?.missionId);
    expect(applied.shots[0].id).toBe('shot_new');
    expect(mission?.actions.some((action) => action.tool === 'generate-video')).toBe(true);
  });

  it('chặn riêng voice chưa cấu hình nhưng vẫn lập các hành động hình ảnh', () => {
    const project = projectFixture();
    project.shots = [{
      id: 'shot_voice',
      sceneId: 'scene_1',
      actionSummary: 'An nói.',
      dialogue: 'Chúng ta bắt đầu.',
      cameraMovement: 'Tĩnh',
      characters: ['char_1'],
      keyframes: [],
    }];
    const { mission } = createCreativeDirectorMission(project);
    const voice = mission.actions.find((action) => action.tool === 'generate-voice');
    expect(voice?.status).toBe('blocked');
    expect(voice?.blockedReason).toContain('hồ sơ giọng');
    expect(mission.actions.some((action) => action.tool === 'generate-character-image' && action.status === 'pending')).toBe(true);
  });

  it('không khởi chạy batch vượt trần ngân sách', () => {
    const project = projectFixture();
    project.creativeDirector!.budgetLimitUsd = 0.01;
    project.shots = [{
      id: 'shot_budget',
      sceneId: 'scene_1',
      actionSummary: 'An bước vào.',
      cameraMovement: 'Tĩnh',
      characters: ['char_1'],
      keyframes: [],
    }];
    const created = createCreativeDirectorMission(project);
    expect(() => startCreativeDirectorMission(created.project, created.mission.id)).toThrow('vượt trần');
  });

  it('đưa nhiệm vụ đang chạy về trạng thái có thể tiếp tục sau khi tải lại', () => {
    const state = createDefaultCreativeDirectorState();
    state.missions = [{
      id: 'mission_interrupted',
      goal: 'Hoàn thiện video',
      status: 'running',
      estimatedCostUsd: 0.1,
      createdAt: 1,
      actions: [{
        id: 'action_interrupted',
        tool: 'generate-video',
        label: 'Dựng video',
        stage: 'director',
        status: 'running',
        dependsOn: [],
        resourceId: 'shot_1',
        estimatedCostUsd: 0.1,
        attempts: 1,
        maxAttempts: 2,
        requiresApproval: true,
        idempotencyKey: 'generate-video:shot_1',
      }],
    }];
    const project = projectFixture();
    project.creativeDirector = state;
    const normalized = normalizeWorkflowState(project);
    expect(normalized.creativeDirector?.missions[0].status).toBe('paused');
    expect(normalized.creativeDirector?.missions[0].actions[0].status).toBe('pending');
  });
});
