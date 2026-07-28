import { describe, expect, it } from 'vitest';
import { CATALOGS, intlLocale, normalizeLocale, translate } from '../services/i18n';

describe('nền tảng giao diện song ngữ', () => {
  it('hai ngôn ngữ có cùng bộ khóa', () => {
    expect(Object.keys(CATALOGS.en).sort()).toEqual(Object.keys(CATALOGS.vi).sort());
  });

  it('mặc định an toàn về tiếng Việt khi locale không hợp lệ', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('vi')).toBe('vi');
    expect(normalizeLocale('fr')).toBe('vi');
    expect(normalizeLocale(null)).toBe('vi');
  });

  it('dịch và thay biến trong thông điệp', () => {
    expect(translate('en', 'campaign.outputCount', { count: 3 })).toBe('3 deliverables');
    expect(translate('vi', 'sidebar.productionProgress', { progress: 72 })).toBe('Tiến độ sản xuất 72%');
  });

  it('cấp locale chuẩn cho Intl', () => {
    expect(intlLocale('en')).toBe('en-US');
    expect(intlLocale('vi')).toBe('vi-VN');
  });
});
