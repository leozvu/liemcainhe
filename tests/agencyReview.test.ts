import { beforeEach, describe, expect, it } from 'vitest';
import { ClientReviewPortal, ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import { createAutoEditorPlan } from '../services/autoEditorService';
import {
  createAgencyReviewRound,
  getAgencyReviewSummary,
  markAgencyReviewPublished,
  syncAgencyReviewFromClientDecision,
  updateAgencyReviewGate,
} from '../services/agencyReviewService';

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
  project.title = 'TVC Egoric';
  project.shots = [
    {
      id: 'shot_1', sceneId: 'scene_1', actionSummary: 'Hook sản phẩm', dialogue: 'Mở đầu', cameraMovement: 'Dolly in', characters: [], keyframes: [],
      interval: { id: 'int_1', startKeyframeId: 'a', endKeyframeId: 'b', duration: 5, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,one', status: 'completed' },
    },
    {
      id: 'shot_2', sceneId: 'scene_1', actionSummary: 'CTA', dialogue: 'Hành động ngay', cameraMovement: 'Tĩnh', characters: [], keyframes: [],
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
  return createAutoEditorPlan(project);
};

const approveInternal = (project: ProjectState): ProjectState => {
  let next = updateAgencyReviewGate(project, 'director', 'approved', 'Hải Director', 'Nhịp ổn');
  next = updateAgencyReviewGate(next, 'editor', 'approved', 'Linh Editor', 'Dựng sạch');
  return updateAgencyReviewGate(next, 'account', 'approved', 'Minh Account', 'Đúng brief');
};

const portalFor = (project: ProjectState, decision: 'pending' | 'changes-requested' | 'approved' = 'pending'): ClientReviewPortal => {
  const roundId = project.agencyReview!.activeRoundId!;
  return {
    id: 'portal_1', projectId: project.id, title: project.title, clientName: 'Khách hàng', status: 'active', decision,
    decisionVersionId: decision === 'pending' ? undefined : 'version_1',
    decidedAt: decision === 'pending' ? undefined : 99,
    versions: [{ id: 'version_1', number: 1, label: 'V1', duration: 9, clips: [], internalRoundId: roundId, createdAt: 10 }],
    comments: [], createdAt: 10, updatedAt: 10,
  };
};

describe('Agency Review Workflow', () => {
  it('mở vòng duyệt theo đúng timeline và tạo checkpoint cùng job theo dõi', () => {
    const project = createAgencyReviewRound(fixture(), 'Bản duyệt V1', 'Bản dựng đầu tiên');
    const summary = getAgencyReviewSummary(project);
    expect(summary.activeRound?.shotIds).toEqual(['shot_2', 'shot_1']);
    expect(summary.activeRound?.gates.map((gate) => gate.status)).toEqual(['pending', 'pending', 'pending']);
    expect(summary.nextRole).toBe('director');
    expect(project.workflow?.checkpoints[0].label).toContain('Bản duyệt V1');
    expect(project.workflow?.jobs[0]).toMatchObject({ kind: 'agency-review', status: 'running', totalUnits: 3 });
  });

  it('bắt buộc duyệt đúng thứ tự Director → Editor → Account', () => {
    const project = createAgencyReviewRound(fixture(), 'V1');
    expect(() => updateAgencyReviewGate(project, 'editor', 'approved', 'Linh Editor')).toThrow(/bước trước/);
    const directed = updateAgencyReviewGate(project, 'director', 'approved', 'Hải Director');
    expect(getAgencyReviewSummary(directed).nextRole).toBe('editor');
  });

  it('chỉ mở cổng khách hàng sau đủ ba chữ ký nội bộ', () => {
    const project = approveInternal(createAgencyReviewRound(fixture(), 'V1'));
    const summary = getAgencyReviewSummary(project);
    expect(summary.readyForClient).toBe(true);
    expect(summary.activeRound?.status).toBe('ready-client');
    expect(project.workflow?.jobs[0]).toMatchObject({ status: 'completed', progress: 100, completedUnits: 3 });
  });

  it('khóa chữ ký cũ khi video thay đổi', () => {
    const project = createAgencyReviewRound(fixture(), 'V1');
    project.shots[0].interval!.videoUrl = 'data:video/mp4;base64,changed';
    expect(getAgencyReviewSummary(project).stale).toBe(true);
    expect(() => updateAgencyReviewGate(project, 'director', 'approved', 'Hải Director')).toThrow(/Media đã thay đổi/);
  });

  it('trả sửa ở Editor sẽ xóa chữ ký downstream và giữ lịch sử upstream', () => {
    let project = createAgencyReviewRound(fixture(), 'V1');
    project = updateAgencyReviewGate(project, 'director', 'approved', 'Hải Director');
    project = updateAgencyReviewGate(project, 'editor', 'changes-requested', 'Linh Editor', 'Sửa nhịp CTA');
    const gates = getAgencyReviewSummary(project).activeRound!.gates;
    expect(gates.map((gate) => gate.status)).toEqual(['approved', 'changes-requested', 'pending']);
    expect(getAgencyReviewSummary(project).activeRound?.status).toBe('changes-requested');
  });

  it('liên kết version khách hàng và đồng bộ kết quả nghiệm thu về vòng nội bộ', () => {
    const approved = approveInternal(createAgencyReviewRound(fixture(), 'V1'));
    const portal = portalFor(approved);
    const published = markAgencyReviewPublished(approved, approved.agencyReview!.activeRoundId!, portal);
    expect(getAgencyReviewSummary(published).activeRound).toMatchObject({ status: 'client-review', portalId: 'portal_1', versionId: 'version_1' });
    const accepted = syncAgencyReviewFromClientDecision(published, { ...portal, decision: 'approved', decisionVersionId: 'version_1', decidedAt: 99 });
    expect(getAgencyReviewSummary(accepted).activeRound).toMatchObject({ status: 'approved', clientDecisionAt: 99 });
  });
});
