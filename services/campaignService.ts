import {
  AgencyCampaign,
  AgencyClient,
  CampaignDeliverable,
  CampaignObjective,
  CampaignPlatform,
  CampaignPriority,
  CampaignStatus,
  ProjectState,
} from '../types';
import { createNewProjectState } from './storageService';
import { buildBrandKitPromptContext, createDefaultBrandKit, normalizeBrandKit } from './brandKitService';

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export interface CreateClientInput {
  name: string;
  brandName?: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  brandKit?: AgencyClient['brandKit'];
}

export interface CreateCampaignInput {
  clientId: string;
  name: string;
  objective: CampaignObjective;
  brief: string;
  product?: string;
  targetAudience: string;
  offer?: string;
  contentPillars?: string[];
  owner: string;
  budget: number;
  currency: 'VND' | 'USD';
  deadline?: number;
  status?: CampaignStatus;
  priority?: CampaignPriority;
  deliverables?: CampaignDeliverable[];
}

export interface CampaignBriefCheck {
  id: 'brand' | 'brief' | 'audience' | 'offer' | 'deliverables' | 'budget' | 'deadline' | 'owner';
  label: string;
  detail: string;
  complete: boolean;
}

export interface CampaignBriefReadiness {
  score: number;
  readyCount: number;
  totalCount: number;
  checks: CampaignBriefCheck[];
  missing: string[];
}

export const createAgencyClient = (input: CreateClientInput): AgencyClient => {
  const now = Date.now();
  const name = input.name.trim();
  if (!name) throw new Error('Tên khách hàng không được để trống.');
  return {
    id: createId('client'),
    name,
    brandName: input.brandName?.trim() || name,
    industry: input.industry?.trim() || 'Chưa phân loại',
    contactName: input.contactName?.trim() || undefined,
    contactEmail: input.contactEmail?.trim() || undefined,
    contactPhone: input.contactPhone?.trim() || undefined,
    website: input.website?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    brandKit: normalizeBrandKit(input.brandKit || createDefaultBrandKit()),
    createdAt: now,
    updatedAt: now,
  };
};

export const createCampaignDeliverable = (input?: Partial<CampaignDeliverable>): CampaignDeliverable => ({
  id: input?.id || createId('deliverable'),
  title: input?.title?.trim() || 'Video quảng cáo chính',
  platform: input?.platform || 'tiktok',
  aspectRatio: input?.aspectRatio || '9:16',
  duration: Math.max(1, Number(input?.duration || 30)),
  quantity: Math.max(1, Math.round(Number(input?.quantity || 1))),
  status: input?.status || 'planned',
  projectId: input?.projectId,
});

export const createAgencyCampaign = (input: CreateCampaignInput): AgencyCampaign => {
  const now = Date.now();
  const name = input.name.trim();
  if (!input.clientId) throw new Error('Hãy chọn khách hàng cho chiến dịch.');
  if (!name) throw new Error('Tên chiến dịch không được để trống.');
  if (!input.owner.trim()) throw new Error('Hãy nhập người phụ trách chiến dịch.');
  return {
    id: createId('campaign'),
    clientId: input.clientId,
    name,
    objective: input.objective,
    brief: input.brief.trim(),
    product: input.product?.trim() || undefined,
    targetAudience: input.targetAudience.trim(),
    offer: input.offer?.trim() || undefined,
    contentPillars: Array.from(new Set((input.contentPillars || []).map((item) => item.trim()).filter(Boolean))).slice(0, 12),
    owner: input.owner.trim(),
    budget: Math.max(0, Number(input.budget) || 0),
    currency: input.currency,
    deadline: input.deadline,
    status: input.status || 'brief',
    priority: input.priority || 'normal',
    deliverables: input.deliverables?.length
      ? input.deliverables.map((deliverable) => createCampaignDeliverable(deliverable))
      : [createCampaignDeliverable()],
    projectIds: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const getCampaignProgress = (campaign: AgencyCampaign): number => {
  if (!campaign.deliverables.length) return campaign.status === 'delivered' ? 100 : 0;
  const weights: Record<CampaignDeliverable['status'], number> = {
    planned: 0,
    'in-progress': 35,
    review: 70,
    approved: 90,
    delivered: 100,
  };
  return Math.round(campaign.deliverables.reduce((sum, deliverable) => sum + weights[deliverable.status], 0) / campaign.deliverables.length);
};

export const getCampaignDeliverableCount = (campaign: AgencyCampaign): number => campaign.deliverables
  .reduce((sum, deliverable) => sum + deliverable.quantity, 0);

const platformLabel: Record<CampaignPlatform, string> = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  website: 'Website',
  other: 'Kênh khác',
};

const objectiveLabel: Record<CampaignObjective, string> = {
  awareness: 'Nhận diện thương hiệu',
  engagement: 'Tăng tương tác',
  leads: 'Thu lead',
  conversion: 'Tăng chuyển đổi',
  retention: 'Giữ chân khách hàng',
  launch: 'Ra mắt sản phẩm',
};

export const getCampaignBriefReadiness = (
  campaign: AgencyCampaign,
  client: AgencyClient,
): CampaignBriefReadiness => {
  const checks: CampaignBriefCheck[] = [
    {
      id: 'brand',
      label: 'Thông tin thương hiệu',
      detail: 'Tên thương hiệu và ngành hàng',
      complete: Boolean(client.brandName.trim() && client.industry.trim()),
    },
    {
      id: 'brief',
      label: 'Bối cảnh và thông điệp',
      detail: 'Brief đủ chi tiết để phát triển concept',
      complete: campaign.brief.trim().length >= 60,
    },
    {
      id: 'audience',
      label: 'Khách hàng mục tiêu',
      detail: 'Chân dung, nhu cầu hoặc pain point',
      complete: campaign.targetAudience.trim().length >= 15,
    },
    {
      id: 'offer',
      label: 'Offer và CTA',
      detail: 'Lý do tin và hành động mong muốn',
      complete: Boolean(campaign.offer?.trim()),
    },
    {
      id: 'deliverables',
      label: 'Định dạng bàn giao',
      detail: 'Kênh, tỷ lệ, thời lượng và số lượng',
      complete: campaign.deliverables.length > 0 && campaign.deliverables.every((item) => (
        Boolean(item.title.trim()) && item.duration > 0 && item.quantity > 0
      )),
    },
    {
      id: 'budget',
      label: 'Ngân sách',
      detail: 'Mức trần để cân đối phương án',
      complete: campaign.budget > 0,
    },
    {
      id: 'deadline',
      label: 'Deadline',
      detail: 'Mốc bàn giao đã được chốt',
      complete: Boolean(campaign.deadline),
    },
    {
      id: 'owner',
      label: 'Người phụ trách',
      detail: 'Account hoặc producer chịu trách nhiệm',
      complete: Boolean(campaign.owner.trim()),
    },
  ];
  const readyCount = checks.filter((check) => check.complete).length;
  return {
    score: Math.round((readyCount / checks.length) * 100),
    readyCount,
    totalCount: checks.length,
    checks,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
};

export const buildCampaignPreProductionPrompt = (
  campaign: AgencyCampaign,
  client: AgencyClient,
  deliverable: CampaignDeliverable,
): string => {
  const readiness = getCampaignBriefReadiness(campaign, client);
  const deadline = campaign.deadline
    ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(campaign.deadline)
    : 'Chưa chốt';
  return [
    'Bạn đang tiếp nhận một campaign brief trực tiếp từ Campaign Hub của Egoric Agency.',
    'Hãy đóng vai Trợ lý Đạo diễn chiến lược và tổ chức buổi tiền kỳ đầu tiên bằng tiếng Việt rõ ràng, thực tế, có thể giao việc ngay cho team agency.',
    '',
    'NGUYÊN TẮC CHO LƯỢT NÀY:',
    '- Chỉ phân tích và lập kế hoạch. Không gọi bất kỳ API ảnh, video hoặc giọng nói nào.',
    '- Phản biện brief, không tự bịa dữ kiện quan trọng. Với dữ kiện còn thiếu, ghi rõ giả định và câu hỏi cần account xác nhận.',
    '- Tạo một đề xuất loại production-plan để tôi có thể duyệt trước khi thay đổi dự án.',
    '- Kế hoạch phải bao phủ: chiến lược sáng tạo, hướng kịch bản/hook, storyboard, moodboard/Visual Bible, sản xuất và duyệt nội bộ.',
    '- Ưu tiên ý tưởng khả thi trong ngân sách, thời lượng và định dạng đã chốt.',
    '',
    'HỒ SƠ THƯƠNG HIỆU:',
    `- Khách hàng: ${client.name}`,
    `- Thương hiệu: ${client.brandName}`,
    `- Ngành hàng: ${client.industry}`,
    client.website ? `- Website: ${client.website}` : '- Website: Chưa cung cấp',
    client.notes ? `- Lưu ý hồ sơ: ${client.notes}` : '- Lưu ý hồ sơ: Chưa có',
    '',
    buildBrandKitPromptContext(client.brandKit),
    '',
    'CHIẾN DỊCH:',
    `- Tên: ${campaign.name}`,
    `- Mục tiêu: ${objectiveLabel[campaign.objective]}`,
    `- Brief: ${campaign.brief || 'Chưa có brief chi tiết'}`,
    `- Sản phẩm / dịch vụ: ${campaign.product || 'Chưa xác định'}`,
    `- Khách hàng mục tiêu: ${campaign.targetAudience || 'Chưa xác định'}`,
    `- Offer / CTA: ${campaign.offer || 'Chưa xác định'}`,
    `- Content pillar: ${campaign.contentPillars.length ? campaign.contentPillars.join(' | ') : 'Chưa xác định'}`,
    `- Ngân sách: ${campaign.budget.toLocaleString('vi-VN')} ${campaign.currency}`,
    `- Deadline: ${deadline}`,
    `- Phụ trách: ${campaign.owner}`,
    '',
    'ĐẦU RA ĐANG TIỀN KỲ:',
    `- ${deliverable.title}`,
    `- Kênh: ${platformLabel[deliverable.platform]}`,
    `- Tỷ lệ: ${deliverable.aspectRatio}`,
    `- Thời lượng: ${deliverable.duration} giây`,
    `- Số phiên bản: ${deliverable.quantity}`,
    '',
    `ĐỘ SẴN SÀNG BRIEF: ${readiness.score}% (${readiness.readyCount}/${readiness.totalCount} hạng mục).`,
    `Còn thiếu: ${readiness.missing.length ? readiness.missing.join(', ') : 'Không có hạng mục bắt buộc nào'}.`,
    '',
    'ĐẦU RA TRẢ LỜI MONG MUỐN:',
    '1. Chẩn đoán brief: cơ hội, rủi ro, dữ kiện còn thiếu và tối đa 5 câu hỏi cần chốt.',
    '2. Một creative direction rõ ràng gồm insight, big idea, thông điệp, tone và lý do phù hợp nền tảng.',
    '3. Hướng hook và cấu trúc kịch bản theo mốc thời gian, chưa cần tạo media.',
    '4. Roadmap storyboard và moodboard/Visual Bible để team tiếp tục duyệt từng bước.',
    '5. Một production-plan có thứ tự ưu tiên, người chịu trách nhiệm gợi ý và cổng duyệt trước khi phát sinh chi phí.',
    '6. Đề xuất các câu trả lời nhanh để tôi lần lượt chốt kịch bản, storyboard và moodboard.',
  ].join('\n');
};

export const createProjectForCampaignDeliverable = (
  campaign: AgencyCampaign,
  client: AgencyClient,
  deliverableId: string,
): { campaign: AgencyCampaign; project: ProjectState } => {
  const deliverable = campaign.deliverables.find((item) => item.id === deliverableId);
  if (!deliverable) throw new Error('Không tìm thấy đầu ra cần sản xuất.');
  const project = createNewProjectState();
  project.title = `${campaign.name} · ${deliverable.title}`;
  project.targetDuration = `${deliverable.duration}s`;
  project.campaignId = campaign.id;
  project.clientId = client.id;
  project.deliverableId = deliverable.id;
  project.brandKitSnapshot = normalizeBrandKit(client.brandKit);
  project.rawScript = [
    `THƯƠNG HIỆU: ${client.brandName}`,
    `CHIẾN DỊCH: ${campaign.name}`,
    `ĐẦU RA: ${deliverable.title} · ${platformLabel[deliverable.platform]} · ${deliverable.aspectRatio} · ${deliverable.duration}s`,
    `MỤC TIÊU: ${campaign.objective}`,
    `SẢN PHẨM / DỊCH VỤ: ${campaign.product || 'Chưa xác định'}`,
    `KHÁCH HÀNG MỤC TIÊU: ${campaign.targetAudience || 'Chưa xác định'}`,
    campaign.offer ? `ƯU ĐÃI / CTA: ${campaign.offer}` : '',
    campaign.contentPillars.length ? `CONTENT PILLAR: ${campaign.contentPillars.join(' | ')}` : '',
    '',
    buildBrandKitPromptContext(client.brandKit),
    '',
    'BRIEF:',
    campaign.brief || 'Hãy phát triển kịch bản phù hợp với mục tiêu chiến dịch.',
  ].filter((line) => line !== '').join('\n');
  const previousProjectId = deliverable.projectId;
  const previousProjectStillUsed = previousProjectId
    ? campaign.deliverables.some((item) => item.id !== deliverableId && item.projectId === previousProjectId)
    : false;
  const nextCampaign: AgencyCampaign = {
    ...campaign,
    status: campaign.status === 'brief' ? 'planning' : campaign.status,
    projectIds: Array.from(new Set([
      ...campaign.projectIds.filter((id) => id !== previousProjectId || previousProjectStillUsed),
      project.id,
    ])),
    deliverables: campaign.deliverables.map((item) => item.id === deliverableId ? {
      ...item,
      projectId: project.id,
      status: item.status === 'planned' ? 'in-progress' : item.status,
    } : item),
    updatedAt: Date.now(),
  };
  return { campaign: nextCampaign, project };
};

export const updateCampaignStatus = (campaign: AgencyCampaign, status: CampaignStatus): AgencyCampaign => ({
  ...campaign,
  status,
  updatedAt: Date.now(),
});

export const updateCampaignDeliverable = (
  campaign: AgencyCampaign,
  deliverableId: string,
  updates: Partial<CampaignDeliverable>,
): AgencyCampaign => ({
  ...campaign,
  deliverables: campaign.deliverables.map((deliverable) => deliverable.id === deliverableId
    ? { ...deliverable, ...updates }
    : deliverable),
  updatedAt: Date.now(),
});
