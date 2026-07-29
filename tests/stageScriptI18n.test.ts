import { describe, expect, it } from 'vitest';
import {
  DURATION_OPTIONS,
  LANGUAGE_OPTIONS,
  VISUAL_STYLE_OPTIONS,
} from '../components/StageScript/constants';
import { validateConfig } from '../components/StageScript/utils';
import { translate } from '../services/i18n';

describe('Script Studio song ngữ', () => {
  it('dịch nhãn nhưng giữ nguyên giá trị cấu hình đã lưu', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([
      'Vietnamese', 'English', 'Japanese', 'French', 'Spanish',
    ]);
    expect(translate('en', LANGUAGE_OPTIONS[0].label)).toBe('Vietnamese');
    expect(DURATION_OPTIONS.find((option) => option.value === '60s')?.value).toBe('60s');
    expect(VISUAL_STYLE_OPTIONS.find((option) => option.value === 'live-action')?.value).toBe('live-action');
  });

  it('trả khóa lỗi để giao diện tự dịch theo locale', () => {
    expect(validateConfig({ script: '', duration: '60s', model: 'gpt-5.2', visualStyle: 'live-action' })).toEqual({
      valid: false,
      error: 'script.validation.script',
    });
  });
});
