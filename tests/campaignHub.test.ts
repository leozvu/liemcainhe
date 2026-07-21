import { describe, expect, it } from 'vitest';
import {
  buildCampaignPreProductionPrompt,
  createAgencyCampaign,
  createAgencyClient,
  createCampaignDeliverable,
  createProjectForCampaignDeliverable,
  getCampaignDeliverableCount,
  getCampaignBriefReadiness,
  getCampaignProgress,
  updateCampaignDeliverable,
} from '../services/campaignService';

describe('Campaign Hub', () => {
  it('tạo hồ sơ khách hàng và chuẩn hóa tên thương hiệu', () => {
    const client = createAgencyClient({ name: 'Công ty Mùa Hè', industry: 'Mỹ phẩm' });
    expect(client.brandName).toBe('Công ty Mùa Hè');
    expect(client.industry).toBe('Mỹ phẩm');
    expect(client.id).toMatch(/^client_/);
  });

  it('tạo campaign nhiều đầu ra và tính tiến độ theo trạng thái', () => {
    const campaign = createAgencyCampaign({
      clientId: 'client_1',
      name: 'Ra mắt serum',
      objective: 'launch',
      brief: 'Video tập trung vào công dụng dưỡng ẩm.',
      targetAudience: 'Nữ 22–35 tuổi',
      owner: 'Lan',
      budget: 20_000_000,
      currency: 'VND',
      deliverables: [
        createCampaignDeliverable({ title: 'TikTok chính', quantity: 3, status: 'in-progress' }),
        createCampaignDeliverable({ title: 'Reel cutdown', platform: 'instagram', quantity: 2, status: 'approved' }),
      ],
    });
    expect(getCampaignDeliverableCount(campaign)).toBe(5);
    expect(getCampaignProgress(campaign)).toBe(63);
  });

  it('tạo project sản xuất từ deliverable và liên kết hai chiều', () => {
    const client = createAgencyClient({ name: 'Acme', brandName: 'Acme Beauty' });
    const campaign = createAgencyCampaign({
      clientId: client.id,
      name: 'Summer Sale',
      objective: 'conversion',
      brief: 'Tập trung ưu đãi mùa hè.',
      targetAudience: 'Người mua online',
      owner: 'Egoric Team',
      budget: 1000,
      currency: 'USD',
      deliverables: [createCampaignDeliverable({ title: 'Video TikTok', duration: 15 })],
    });
    const deliverable = campaign.deliverables[0];
    const created = createProjectForCampaignDeliverable(campaign, client, deliverable.id);
    expect(created.project.campaignId).toBe(campaign.id);
    expect(created.project.clientId).toBe(client.id);
    expect(created.project.deliverableId).toBe(deliverable.id);
    expect(created.project.targetDuration).toBe('15s');
    expect(created.project.rawScript).toContain('Acme Beauty');
    expect(created.campaign.projectIds).toContain(created.project.id);
    expect(created.campaign.deliverables[0].projectId).toBe(created.project.id);
    expect(created.campaign.deliverables[0].status).toBe('in-progress');
  });

  it('cập nhật một deliverable mà không làm thay đổi các đầu ra khác', () => {
    const campaign = createAgencyCampaign({
      clientId: 'client_1',
      name: 'Campaign',
      objective: 'awareness',
      brief: '',
      targetAudience: '',
      owner: 'Producer',
      budget: 0,
      currency: 'VND',
      deliverables: [createCampaignDeliverable({ title: 'A' }), createCampaignDeliverable({ title: 'B' })],
    });
    const next = updateCampaignDeliverable(campaign, campaign.deliverables[0].id, { status: 'review' });
    expect(next.deliverables[0].status).toBe('review');
    expect(next.deliverables[1].status).toBe('planned');
  });

  it('chấm độ sẵn sàng của brief và chỉ rõ hạng mục còn thiếu', () => {
    const client = createAgencyClient({ name: 'Egoric Client', brandName: 'Lumière', industry: 'Chăm sóc da' });
    const campaign = createAgencyCampaign({
      clientId: client.id,
      name: 'Brand film',
      objective: 'awareness',
      brief: 'Kể câu chuyện làn da tự tin qua một ngày bận rộn, nhấn mạnh cảm giác nhẹ và tự nhiên của sản phẩm.',
      targetAudience: 'Nữ nhân viên văn phòng 25–35 tuổi, ưu tiên sản phẩm dịu nhẹ',
      offer: 'Khám phá bộ sản phẩm mới tại website',
      owner: 'Producer Egoric',
      budget: 30_000_000,
      currency: 'VND',
      deadline: new Date('2026-08-30T12:00:00').getTime(),
      deliverables: [createCampaignDeliverable({ title: 'Phim dọc chủ đạo', duration: 30, quantity: 3 })],
    });
    const readiness = getCampaignBriefReadiness(campaign, client);
    expect(readiness.score).toBe(100);
    expect(readiness.missing).toEqual([]);

    const incomplete = getCampaignBriefReadiness({ ...campaign, offer: undefined, deadline: undefined }, client);
    expect(incomplete.score).toBe(75);
    expect(incomplete.missing).toEqual(['Offer và CTA', 'Deadline']);
  });

  it('tạo prompt tiền kỳ đủ ngữ cảnh nhưng cấm gọi API media', () => {
    const client = createAgencyClient({ name: 'Công ty Ánh Dương', brandName: 'Sol', industry: 'F&B' });
    const campaign = createAgencyCampaign({
      clientId: client.id,
      name: 'Mùa hè vị mới',
      objective: 'launch',
      brief: 'Ra mắt thức uống mùa hè với tinh thần trẻ trung và chuyển động nhanh.',
      targetAudience: 'Gen Z tại thành phố, thích trải nghiệm hương vị mới',
      offer: 'Mua một tặng một trong tuần đầu',
      owner: 'Minh',
      budget: 15_000_000,
      currency: 'VND',
      deliverables: [createCampaignDeliverable({ title: 'TikTok hero', platform: 'tiktok', duration: 20, quantity: 2 })],
    });
    const prompt = buildCampaignPreProductionPrompt(campaign, client, campaign.deliverables[0]);
    expect(prompt).toContain('Trợ lý Đạo diễn chiến lược');
    expect(prompt).toContain('Sol');
    expect(prompt).toContain('TikTok hero');
    expect(prompt).toContain('Không gọi bất kỳ API ảnh, video hoặc giọng nói nào');
    expect(prompt).toContain('production-plan');
    expect(prompt).not.toContain('支付宝');
  });
});
