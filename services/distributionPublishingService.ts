import {
  DistributionAdapterReadiness,
  DistributionConnection,
  DistributionPackage,
  DistributionPlatform,
  DistributionPublishJob,
  DistributionVisibility,
} from '../types';
import { isHostedRuntime } from './hostedRuntime';

export interface DistributionOperationsWorkspace {
  connections: DistributionConnection[];
  jobs: DistributionPublishJob[];
  adapters: DistributionAdapterReadiness[];
  hosted: boolean;
}

export interface QueueDistributionJobInput {
  packageId: string;
  platform: DistributionPlatform;
  connectionId: string;
  visibility?: DistributionVisibility;
}

export interface DistributionJobResult {
  job: DistributionPublishJob;
  package?: DistributionPackage;
  duplicate?: boolean;
}

const hostedWorkspace = isHostedRuntime;

const parseResponse = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
};

export const getDistributionOperations = async (projectId: string): Promise<DistributionOperationsWorkspace> => {
  if (!hostedWorkspace()) return { connections: [], jobs: [], adapters: [], hosted: false };
  const response = await fetch(`/api/distribution-operations?projectId=${encodeURIComponent(projectId)}`);
  const payload = await parseResponse<Omit<DistributionOperationsWorkspace, 'hosted'>>(
    response,
    'Không thể tải hàng đợi xuất bản.',
  );
  return { ...payload, hosted: true };
};

export const startDistributionOAuth = async (
  projectId: string,
  platform: DistributionPlatform,
): Promise<string> => {
  const query = new URLSearchParams({ projectId, platform });
  const response = await fetch(`/api/distribution-oauth/start?${query}`);
  const payload = await parseResponse<{ authorizeUrl: string }>(response, 'Không thể bắt đầu kết nối OAuth.');
  return payload.authorizeUrl;
};

export const disconnectDistributionConnection = async (connectionId: string): Promise<void> => {
  const response = await fetch(`/api/distribution-connections?id=${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
  await parseResponse<{ success: true }>(response, 'Không thể ngắt kết nối tài khoản.');
};

export const queueDistributionJob = async (
  projectId: string,
  input: QueueDistributionJobInput,
): Promise<DistributionJobResult> => {
  const response = await fetch(`/api/distribution-jobs?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'queue', ...input }),
  });
  return parseResponse<DistributionJobResult>(response, 'Không thể xếp hàng xuất bản.');
};

export const advanceDistributionJob = async (
  projectId: string,
  jobId: string,
  reconcile = false,
): Promise<DistributionJobResult> => {
  const response = await fetch(`/api/distribution-jobs?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: reconcile ? 'reconcile' : 'run', jobId }),
  });
  return parseResponse<DistributionJobResult>(response, reconcile ? 'Không thể đối soát trạng thái.' : 'Không thể tiếp tục upload.');
};

export const isDistributionJobActive = (job: DistributionPublishJob): boolean => (
  ['queued', 'uploading'].includes(job.status)
);

export const formatDistributionProgress = (job: DistributionPublishJob): string => {
  if (job.status === 'published') return 'Đã xuất bản';
  if (job.status === 'awaiting-user') return 'Chờ creator hoàn tất trong TikTok';
  if (job.status === 'processing') return 'Nền tảng đang xử lý';
  if (job.status === 'indeterminate') return 'Chưa rõ kết quả — cần đối soát';
  if (job.status === 'failed') return job.retrySafe ? 'Thất bại — có thể thử lại' : 'Thất bại — cần kiểm tra thủ công';
  if (job.status === 'cancelled') return 'Đã hủy';
  if (job.status === 'uploading') return `Đang upload ${Math.round(job.progress)}%`;
  return 'Đã xếp hàng';
};
