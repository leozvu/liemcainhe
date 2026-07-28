import { beforeEach, describe, expect, it } from 'vitest';
import { ClientReviewPortal, DistributionPackage, ProjectState } from '../types';
import { createNewProjectState } from '../services/storageService';
import { createAutoEditorPlan, updateAutoEditorSettings } from '../services/autoEditorService';
import {
  createAgencyReviewRound,
  markAgencyReviewPublished,
  selectAgencyReviewMaster,
  syncAgencyReviewFromClientDecision,
  updateAgencyReviewGate,
} from '../services/agencyReviewService';
import {
  getCompatibleDistributionPlatforms,
  getDistributionEligibility,
  isDistributionPackageCurrent,
  platformAcceptsAspectRatio,
  serializeDistributionManifest,
} from '../services/distributionGatewayService';

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

const approvedFixture = (): { project: ProjectState; portal: ClientReviewPortal } => {
  let project = createNewProjectState();
  project.title = 'TVC Egoric';
  project.shots = [{
    id: 'shot_1', sceneId: 'scene_1', actionSummary: 'Packshot', dialogue: 'Bắt đầu ngay', cameraMovement: 'Tĩnh', characters: [], keyframes: [],
    interval: { id: 'int_1', startKeyframeId: 'a', endKeyframeId: 'b', duration: 8, motionStrength: 0.5, videoUrl: 'data:video/mp4;base64,one', status: 'completed' },
  }];
  project = createAutoEditorPlan(updateAutoEditorSettings(project, { aspectRatios: ['16:9'] }));
  const output = project.autoEditor!.outputs[0];
  project.autoEditor!.outputs = project.autoEditor!.outputs.map((item) => item.id === output.id ? {
    ...item,
    status: 'ready',
    storage: 'cloud',
    videoUrl: `/api/cloud/media/${project.id}/editor/masters/${item.id}.mp4`,
    checksum: 'sha256-master-approved',
    bytes: 12_000_000,
    archivedAt: 50,
  } : item);
  project = selectAgencyReviewMaster(project, output.id);
  project = createAgencyReviewRound(project, 'Master V1', undefined, output.id);
  project = updateAgencyReviewGate(project, 'director', 'approved', 'Hải Director');
  project = updateAgencyReviewGate(project, 'editor', 'approved', 'Linh Editor');
  project = updateAgencyReviewGate(project, 'account', 'approved', 'Minh Account');
  const roundId = project.agencyReview!.activeRoundId!;
  const signature = `master:${output.id}:sha256-master-approved`;
  const portal: ClientReviewPortal = {
    id: 'portal_1', projectId: project.id, title: project.title, clientName: 'Khách hàng', status: 'active',
    decision: 'approved', decisionVersionId: 'version_1', decisionArtifactSignature: signature, decidedAt: 100,
    versions: [{
      id: 'version_1', number: 1, label: 'Master V1', duration: 8, clips: [], internalRoundId: roundId,
      sourceKind: 'master', masterOutputId: output.id, artifactChecksum: 'sha256-master-approved',
      artifactSignature: signature, artifactBytes: 12_000_000, aspectRatio: '16:9', createdAt: 80,
    }],
    comments: [], createdAt: 60, updatedAt: 100,
  };
  project = markAgencyReviewPublished(project, roundId, portal);
  project = syncAgencyReviewFromClientDecision(project, portal);
  return { project, portal };
};

const packageFor = (project: ProjectState, portal: ClientReviewPortal): DistributionPackage => {
  const source = getDistributionEligibility(project, [portal]).source!;
  return {
    id: 'distribution_1', projectId: project.id, name: 'Gói chính', status: 'ready',
    reviewRoundId: source.round.id, reviewPortalId: portal.id, reviewVersionId: source.version.id,
    masterOutputId: source.master.id, masterChecksum: source.master.checksum!, artifactSignature: source.artifactSignature,
    approvalFingerprint: source.artifactSignature, masterVideoUrl: source.master.videoUrl!, aspectRatio: source.master.aspectRatio,
    artifactBytes: source.master.bytes, duration: 8, title: project.title,
    targets: [{ platform: 'youtube', status: 'ready', updatedAt: 110 }], idempotencyKey: 'idem_1', createdAt: 110, updatedAt: 110,
  };
};

describe('Distribution Gateway', () => {
  it('chỉ mở gate khi ba chữ ký, quyết định khách và fingerprint cùng trỏ một master', () => {
    const { project, portal } = approvedFixture();
    const result = getDistributionEligibility(project, [portal]);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.source).toMatchObject({
      artifactSignature: expect.stringContaining('sha256-master-approved'),
      master: { storage: 'cloud', aspectRatio: '16:9' },
      version: { sourceKind: 'master' },
    });
  });

  it('khóa phân phối khi checksum master hoặc chữ ký quyết định thay đổi', () => {
    const { project, portal } = approvedFixture();
    project.autoEditor!.outputs.find((item) => item.id === project.agencyReview!.preferredMasterOutputId)!.checksum = 'sha256-mutated';
    expect(getDistributionEligibility(project, [portal])).toMatchObject({ eligible: false });
    const clean = approvedFixture();
    clean.portal.decisionArtifactSignature = 'master:wrong:checksum';
    expect(getDistributionEligibility(clean.project, [clean.portal]).blockers.map((item) => item.id)).toContain('approval-fingerprint');
  });

  it('không bỏ qua góp ý mở dù khách đã bấm phê duyệt', () => {
    const { project, portal } = approvedFixture();
    portal.comments.push({ id: 'comment_1', versionId: 'version_1', clipId: 'clip_1', authorName: 'Khách', body: 'Sửa CTA', timecodeSeconds: 3, status: 'open', createdAt: 90, updatedAt: 90 });
    expect(getDistributionEligibility(project, [portal]).blockers.map((item) => item.id)).toContain('open-comments');
  });

  it('chỉ bật adapter tương thích với tỷ lệ master', () => {
    expect(getCompatibleDistributionPlatforms('16:9')).toEqual(['youtube']);
    expect(getCompatibleDistributionPlatforms('9:16')).toEqual(['tiktok', 'youtube', 'instagram-reels', 'facebook-reels']);
    expect(platformAcceptsAspectRatio('tiktok', '16:9')).toBe(false);
  });

  it('manifest giữ đúng fingerprint và phát hiện package không còn khớp project', () => {
    const { project, portal } = approvedFixture();
    const item = packageFor(project, portal);
    expect(isDistributionPackageCurrent(project, item)).toBe(true);
    expect(serializeDistributionManifest(item)).toContain('egoric.distribution-package.v1');
    project.autoEditor!.outputs.find((output) => output.id === item.masterOutputId)!.checksum = 'changed';
    expect(isDistributionPackageCurrent(project, item)).toBe(false);
  });
});
