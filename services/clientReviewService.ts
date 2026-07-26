import {
  ClientReviewComment,
  ClientReviewCommentStatus,
  ClientReviewDecisionStatus,
  ClientReviewPortal,
  ClientReviewPortalStatus,
  ProjectState,
} from '../types';
import { updateCampaignDeliverable, updateCampaignStatus } from './campaignService';
import { getAllAgencyCampaigns, saveAgencyCampaign } from './storageService';

export interface ClientReviewWorkspace {
  portals: ClientReviewPortal[];
  hosted: boolean;
}

export interface PublishClientReviewInput {
  title: string;
  clientName: string;
  campaignName?: string;
  deliverableTitle?: string;
  versionLabel: string;
  versionNote?: string;
  expiresInDays: number;
  internalRoundId: string;
}

export interface PublicReviewCommentInput {
  versionId: string;
  clipId: string;
  authorName: string;
  authorEmail?: string;
  body: string;
  timecodeSeconds: number;
}

export interface PublicReviewDecisionInput {
  decision: Exclude<ClientReviewDecisionStatus, 'pending'>;
  versionId: string;
  reviewerName: string;
  reviewerEmail?: string;
  note?: string;
}

const hostedWorkspace = (): boolean => typeof window !== 'undefined'
  && window.location.hostname.endsWith('.chatgpt.site');

const parseResponse = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
};

export const getClientReviewWorkspace = async (projectId: string): Promise<ClientReviewWorkspace> => {
  if (!hostedWorkspace()) return { portals: [], hosted: false };
  const response = await fetch(`/api/client-reviews?projectId=${encodeURIComponent(projectId)}`);
  const payload = await parseResponse<{ portals?: ClientReviewPortal[] }>(response, 'Không thể tải cổng duyệt khách hàng.');
  return { portals: payload.portals || [], hosted: true };
};

export const publishClientReview = async (
  projectId: string,
  input: PublishClientReviewInput,
): Promise<ClientReviewPortal> => {
  const response = await fetch(`/api/client-reviews?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<{ portal: ClientReviewPortal }>(response, 'Không thể phát hành bản duyệt.')).portal;
};

export const updateClientReviewPortal = async (
  projectId: string,
  input: {
    portalId: string;
    status?: ClientReviewPortalStatus;
    commentId?: string;
    commentStatus?: ClientReviewCommentStatus;
    resetDecision?: boolean;
  },
): Promise<ClientReviewPortal> => {
  const response = await fetch(`/api/client-reviews?projectId=${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<{ portal: ClientReviewPortal }>(response, 'Không thể cập nhật cổng duyệt.')).portal;
};

export const getPublicClientReview = async (token: string): Promise<ClientReviewPortal> => {
  const response = await fetch(`/api/client-review/${encodeURIComponent(token)}`);
  const payload = await parseResponse<{ portal?: ClientReviewPortal }>(response, 'Không thể mở bản duyệt này.');
  if (!payload.portal) throw new Error('Máy chủ không trả về dữ liệu bản duyệt hợp lệ.');
  return payload.portal;
};

export const createPublicReviewComment = async (
  token: string,
  input: PublicReviewCommentInput,
): Promise<ClientReviewComment> => {
  const response = await fetch(`/api/client-review/${encodeURIComponent(token)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<{ comment: ClientReviewComment }>(response, 'Không thể gửi góp ý.')).comment;
};

export const submitPublicReviewDecision = async (
  token: string,
  input: PublicReviewDecisionInput,
): Promise<ClientReviewPortal> => {
  const response = await fetch(`/api/client-review/${encodeURIComponent(token)}/decision`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await parseResponse<{ portal: ClientReviewPortal }>(response, 'Không thể gửi quyết định duyệt.')).portal;
};

export const formatReviewTimecode = (seconds: number, fps = 25): string => {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.round(safeSeconds * fps);
  const hours = Math.floor(totalFrames / (fps * 3600));
  const minutes = Math.floor((totalFrames % (fps * 3600)) / (fps * 60));
  const secs = Math.floor((totalFrames % (fps * 60)) / fps);
  const frames = totalFrames % fps;
  return [hours, minutes, secs, frames].map((value) => String(value).padStart(2, '0')).join(':');
};

export const getClientReviewSummary = (portal?: ClientReviewPortal) => {
  const comments = portal?.comments || [];
  const versions = portal?.versions || [];
  return {
    versionCount: versions.length,
    latestVersion: versions.at(-1),
    openComments: comments.filter((comment) => comment.status === 'open').length,
    resolvedComments: comments.filter((comment) => comment.status === 'resolved').length,
    isLocked: portal?.decision === 'approved' || portal?.status === 'closed',
  };
};

export const syncClientReviewDecisionToCampaign = async (
  project: ProjectState,
  portal?: ClientReviewPortal,
): Promise<void> => {
  if (!portal || !project.campaignId || !project.deliverableId) return;
  const campaign = (await getAllAgencyCampaigns()).find((item) => item.id === project.campaignId);
  if (!campaign) return;
  const deliverableStatus = portal.decision === 'approved'
    ? 'approved' as const
    : portal.decision === 'changes-requested'
      ? 'in-progress' as const
      : 'review' as const;
  const deliverable = campaign.deliverables.find((item) => item.id === project.deliverableId);
  const campaignStatus = portal.decision === 'changes-requested' ? 'production' as const : 'review' as const;
  if (deliverable?.status === deliverableStatus && campaign.status === campaignStatus) return;
  const next = updateCampaignStatus(
    updateCampaignDeliverable(campaign, project.deliverableId, { status: deliverableStatus }),
    campaignStatus,
  );
  await saveAgencyCampaign(next);
};
