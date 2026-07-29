import {
  AgencyReviewRound,
  AspectRatio,
  AutoEditorOutput,
  ClientReviewPortal,
  ClientReviewVersion,
  DistributionPackage,
  DistributionPlatform,
  ProjectState,
} from '../types';
import { getAgencyReviewSourceSignature } from './agencyReviewService';
import { isHostedRuntime } from './hostedRuntime';

export interface DistributionPlatformMeta {
  label: string;
  shortLabel: string;
  detail: string;
  allowedAspectRatios: AspectRatio[];
  connectionLabel: string;
}

export const DISTRIBUTION_PLATFORM_META: Record<DistributionPlatform, DistributionPlatformMeta> = {
  tiktok: {
    label: 'TikTok',
    shortLabel: 'TikTok',
    detail: 'Video dọc cho Content Posting API',
    allowedAspectRatios: ['9:16'],
    connectionLabel: 'TikTok Content Posting',
  },
  youtube: {
    label: 'YouTube / Shorts',
    shortLabel: 'YouTube',
    detail: 'Video ngang hoặc Shorts dọc',
    allowedAspectRatios: ['16:9', '9:16', '1:1'],
    connectionLabel: 'YouTube Data API',
  },
  'instagram-reels': {
    label: 'Instagram Reels',
    shortLabel: 'Instagram',
    detail: 'Reel dọc cho tài khoản chuyên nghiệp',
    allowedAspectRatios: ['9:16'],
    connectionLabel: 'Instagram Graph API',
  },
  'facebook-reels': {
    label: 'Facebook Reels',
    shortLabel: 'Facebook',
    detail: 'Reel dọc cho Page đã kết nối',
    allowedAspectRatios: ['9:16'],
    connectionLabel: 'Facebook Graph API',
  },
};

export interface DistributionBlocker {
  id: string;
  label: string;
  detail: string;
}

export interface ApprovedDistributionSource {
  round: AgencyReviewRound;
  portal: ClientReviewPortal;
  version: ClientReviewVersion;
  master: AutoEditorOutput;
  artifactSignature: string;
}

export interface DistributionEligibility {
  eligible: boolean;
  blockers: DistributionBlocker[];
  source?: ApprovedDistributionSource;
}

export interface CreateDistributionPackageInput {
  name: string;
  title: string;
  caption?: string;
  platforms: DistributionPlatform[];
  reviewRoundId: string;
  reviewPortalId: string;
  reviewVersionId: string;
  masterOutputId: string;
}

export interface DistributionWorkspace {
  packages: DistributionPackage[];
  hosted: boolean;
}

const blocker = (id: string, label: string, detail: string): DistributionBlocker => ({ id, label, detail });

const findCandidateRound = (project: ProjectState, portals: ClientReviewPortal[]): AgencyReviewRound | undefined => {
  const rounds = [...(project.agencyReview?.rounds || [])]
    .sort((left, right) => (right.clientDecisionAt || right.updatedAt) - (left.clientDecisionAt || left.updatedAt));
  return rounds.find((round) => portals.some((portal) => portal.id === round.portalId && portal.decision === 'approved'))
    || rounds.find((round) => round.id === project.agencyReview?.activeRoundId)
    || rounds[0];
};

export const getDistributionEligibility = (
  project: ProjectState,
  portals: ClientReviewPortal[],
): DistributionEligibility => {
  const blockers: DistributionBlocker[] = [];
  const round = findCandidateRound(project, portals);
  if (!round) return {
    eligible: false,
    blockers: [blocker('round', 'Chưa có vòng duyệt', 'Hãy gửi một master qua Director → Editor → Account rồi mời khách nghiệm thu.')],
  };

  const gatesApproved = ['director', 'editor', 'account'].every((role) => (
    round.gates.find((gate) => gate.role === role)?.status === 'approved'
  ));
  if (!gatesApproved) blockers.push(blocker('internal-gates', 'Thiếu chữ ký nội bộ', 'Cần đủ Director, Editor và Account trên cùng vòng duyệt.'));

  const master = (project.autoEditor?.outputs || []).find((output) => output.id === round.masterOutputId);
  if (!round.masterOutputId || !round.masterChecksum) {
    blockers.push(blocker('master-lock', 'Vòng duyệt chưa khóa master', 'Mở vòng duyệt mới từ một master cloud có checksum.'));
  } else if (!master || master.status !== 'ready' || master.storage !== 'cloud' || !master.videoUrl || !master.checksum) {
    blockers.push(blocker('master-cloud', 'Master không còn sẵn sàng', 'Master phải tồn tại trên cloud, có URL và checksum hợp lệ.'));
  } else if (master.checksum !== round.masterChecksum) {
    blockers.push(blocker('master-checksum', 'Checksum master đã đổi', 'File hiện tại không còn là file được team ký duyệt. Hãy mở vòng mới.'));
  }

  if (round.sourceSignature !== getAgencyReviewSourceSignature(project, round.shotIds, round.masterOutputId)) {
    blockers.push(blocker('source-signature', 'Nguồn dựng đã thay đổi', 'Timeline, media hoặc cấu hình dựng đã đổi sau vòng duyệt.'));
  }

  const portal = portals.find((item) => item.id === round.portalId);
  if (!portal) blockers.push(blocker('portal', 'Chưa tải được quyết định khách hàng', 'Làm mới cổng duyệt trên bản production đã đăng nhập.'));
  else if (portal.decision !== 'approved') blockers.push(blocker('client-decision', 'Khách chưa nghiệm thu', 'Chỉ quyết định “Phê duyệt” trên version mới nhất mới mở được cổng phân phối.'));

  const version = portal?.versions.find((item) => item.id === portal.decisionVersionId);
  if (portal && !version) blockers.push(blocker('review-version', 'Không tìm thấy version đã duyệt', 'Quyết định khách hàng không còn trỏ tới một version hợp lệ.'));

  const expectedSignature = master?.checksum && master?.id ? `master:${master.id}:${master.checksum}` : undefined;
  if (version && (
    version.id !== round.versionId
    || version.sourceKind !== 'master'
    || version.masterOutputId !== round.masterOutputId
    || version.artifactChecksum !== round.masterChecksum
  )) {
    blockers.push(blocker('version-contract', 'Version không trùng master', 'Version khách xem không khớp output ID hoặc checksum của vòng duyệt.'));
  }
  if (version && expectedSignature && (
    version.artifactSignature !== expectedSignature
    || portal?.decisionArtifactSignature !== expectedSignature
  )) {
    blockers.push(blocker('approval-fingerprint', 'Chữ ký nghiệm thu không hợp lệ', 'Fingerprint trên quyết định khách hàng không trùng artifact hiện tại.'));
  }
  if (portal?.comments.some((comment) => comment.versionId === version?.id && comment.status === 'open')) {
    blockers.push(blocker('open-comments', 'Còn góp ý chưa xử lý', 'Giải quyết toàn bộ góp ý mở trên version đã nghiệm thu trước khi phân phối.'));
  }

  const source = round && portal && version && master && expectedSignature
    ? { round, portal, version, master, artifactSignature: expectedSignature }
    : undefined;
  return { eligible: blockers.length === 0 && Boolean(source), blockers, source };
};

export const platformAcceptsAspectRatio = (
  platform: DistributionPlatform,
  aspectRatio?: AspectRatio,
): boolean => Boolean(aspectRatio && DISTRIBUTION_PLATFORM_META[platform].allowedAspectRatios.includes(aspectRatio));

export const getCompatibleDistributionPlatforms = (aspectRatio?: AspectRatio): DistributionPlatform[] => (
  (Object.keys(DISTRIBUTION_PLATFORM_META) as DistributionPlatform[])
    .filter((platform) => platformAcceptsAspectRatio(platform, aspectRatio))
);

export const isDistributionPackageCurrent = (project: ProjectState, item: DistributionPackage): boolean => {
  const output = (project.autoEditor?.outputs || []).find((candidate) => candidate.id === item.masterOutputId);
  return Boolean(output
    && output.status === 'ready'
    && output.storage === 'cloud'
    && output.checksum === item.masterChecksum
    && `master:${output.id}:${output.checksum}` === item.artifactSignature);
};

const hostedWorkspace = isHostedRuntime;

const parseResponse = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
};

export const getDistributionWorkspace = async (projectId: string): Promise<DistributionWorkspace> => {
  if (!hostedWorkspace()) return { packages: [], hosted: false };
  const response = await fetch(`/api/distribution-packages?projectId=${encodeURIComponent(projectId)}`);
  const payload = await parseResponse<{ packages?: DistributionPackage[] }>(response, 'Không thể tải cổng phân phối.');
  return { packages: payload.packages || [], hosted: true };
};

export const createDistributionPackage = async (
  projectId: string,
  input: CreateDistributionPackageInput,
): Promise<DistributionPackage> => {
  const response = await fetch(`/api/distribution-packages?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<{ package: DistributionPackage }>(response, 'Không thể tạo gói phân phối.')).package;
};

export const serializeDistributionManifest = (item: DistributionPackage): string => JSON.stringify({
  schema: 'egoric.distribution-package.v1',
  package: item,
}, null, 2);
