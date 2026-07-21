import { describe, expect, it } from 'vitest';
import {
  buildBrandKitPromptContext,
  getBrandKitReadiness,
  inspectBrandCompliance,
  normalizeBrandKit,
} from '../services/brandKitService';
import {
  createAgencyCampaign,
  createAgencyClient,
  createProjectForCampaignDeliverable,
} from '../services/campaignService';

const completeKit = () => normalizeBrandKit({
  colors: [{ id: 'cyan', name: 'Xanh chủ đạo', hex: '#18D8E8', usage: 'CTA' }],
  fonts: ['Be Vietnam Pro'],
  assets: [
    { id: 'logo', type: 'logo', name: 'Logo Lumière', url: 'data:image/png;base64,logo' },
    { id: 'product', type: 'product', name: 'Serum Lumière', url: 'data:image/png;base64,product', notes: 'Không đổi màu nắp chai' },
  ],
  voiceProfile: { name: 'Nữ miền Nam', providerId: 'elevenlabs', voiceId: 'voice_1', language: 'Tiếng Việt' },
  toneOfVoice: 'Tự tin, gần gũi, câu ngắn và không khoa trương.',
  mandatoryTerms: ['Lumière'],
  forbiddenTerms: ['cam kết 100%'],
  ctas: ['Khám phá ngay'],
  approvedExamples: ['Lumière — dịu nhẹ để bạn tự tin mỗi ngày.'],
  platformRules: [{ platform: 'tiktok', safeZone: 'Chừa 15% cạnh phải', captionStyle: 'Tối đa hai dòng' }],
  updatedAt: 1,
});

describe('Brand Kit memory', () => {
  it('nâng cấp hồ sơ cũ thành Brand Kit an toàn', () => {
    const kit = normalizeBrandKit(undefined);
    expect(kit.colors).toEqual([]);
    expect(kit.assets).toEqual([]);
    expect(kit.toneOfVoice).toBe('');
  });

  it('chấm độ hoàn thiện và tạo context không làm lộ dữ liệu ảnh', () => {
    const kit = completeKit();
    const readiness = getBrandKitReadiness(kit);
    const context = buildBrandKitPromptContext(kit);
    expect(readiness.score).toBe(100);
    expect(context).toContain('Logo Lumière');
    expect(context).toContain('Không đổi màu nắp chai');
    expect(context).toContain('Chừa 15% cạnh phải');
    expect(context).not.toContain('data:image/png');
  });

  it('phát hiện từ cấm, thiếu từ bắt buộc và CTA chưa duyệt', () => {
    const report = inspectBrandCompliance('Sản phẩm này cam kết 100% hiệu quả.', completeKit());
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(50);
    expect(report.violations.join(' ')).toContain('cam kết 100%');
    expect(report.violations.join(' ')).toContain('Lumière');
    expect(report.warnings.join(' ')).toContain('CTA');
  });

  it('đóng băng Brand Kit vào project và nạp vào brief sản xuất', () => {
    const client = createAgencyClient({ name: 'Công ty Ánh Sáng', brandName: 'Lumière', brandKit: completeKit() });
    const campaign = createAgencyCampaign({
      clientId: client.id,
      name: 'Ra mắt serum',
      objective: 'launch',
      brief: 'Ra mắt serum dưỡng ẩm dịu nhẹ với hình ảnh hiện đại và gần gũi.',
      product: 'Serum Lumière',
      targetAudience: 'Nữ văn phòng 25–35 tuổi',
      offer: 'Khám phá ngay',
      contentPillars: ['Giải thích sản phẩm', 'Routine buổi sáng'],
      owner: 'Producer',
      budget: 10_000_000,
      currency: 'VND',
    });
    const created = createProjectForCampaignDeliverable(campaign, client, campaign.deliverables[0].id);
    expect(created.project.brandKitSnapshot?.mandatoryTerms).toEqual(['Lumière']);
    expect(created.project.rawScript).toContain('CONTENT PILLAR: Giải thích sản phẩm | Routine buổi sáng');
    expect(created.project.rawScript).toContain('BRAND KIT — NGUỒN SỰ THẬT BẮT BUỘC');
  });
});
