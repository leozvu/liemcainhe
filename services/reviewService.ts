import { CoreStage } from '../types';
import { isHostedRuntime } from './hostedRuntime';

export type ReviewNoteStatus = 'open' | 'resolved';
export type ApprovalStatus = 'pending' | 'changes-requested' | 'approved';

export interface ReviewNote {
  id: string;
  shotId?: string;
  stage: CoreStage;
  body: string;
  status: ReviewNoteStatus;
  createdAt: number;
  updatedAt: number;
}

export interface StageApproval {
  stage: CoreStage;
  status: ApprovalStatus;
  note?: string;
  approvedBy: string;
  updatedAt: number;
}

export interface ReviewWorkspace {
  notes: ReviewNote[];
  approvals: StageApproval[];
  hosted: boolean;
}

const emptyWorkspace = (): ReviewWorkspace => ({ notes: [], approvals: [], hosted: false });

export const getReviewWorkspace = async (projectId: string): Promise<ReviewWorkspace> => {
  if (!isHostedRuntime()) return emptyWorkspace();
  const response = await fetch(`/api/reviews?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) return emptyWorkspace();
  const payload = await response.json();
  return { notes: payload.notes || [], approvals: payload.approvals || [], hosted: true };
};

export const createReviewNote = async (projectId: string, input: { stage: CoreStage; shotId?: string; body: string }): Promise<ReviewNote> => {
  const response = await fetch(`/api/reviews?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Không thể thêm ghi chú duyệt');
  return payload.note;
};

export const setReviewNoteStatus = async (projectId: string, id: string, status: ReviewNoteStatus): Promise<void> => {
  const response = await fetch(`/api/reviews?projectId=${encodeURIComponent(projectId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
  });
  if (!response.ok) throw new Error('Không thể cập nhật ghi chú duyệt');
};

export const saveStageApproval = async (projectId: string, input: { stage: CoreStage; status: ApprovalStatus; note?: string }): Promise<StageApproval> => {
  const response = await fetch(`/api/reviews?projectId=${encodeURIComponent(projectId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Không thể lưu trạng thái duyệt');
  return payload.approval;
};
