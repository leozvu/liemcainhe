import { describe, expect, it } from 'vitest';
import {
  APPROACH_OPTIONS,
  AUDIENCE_OPTIONS,
  INTENT_OPTIONS,
  VOICE_OPTIONS,
} from '../services/content/contentAxes';
import { ARTICLE_LAYOUTS } from '../services/content/articleHtmlService';
import { PUBLISH_CHANNELS } from '../services/content/publishChannels';
import { CREATIVE_LENSES } from '../services/content/creativeDirectionService';
import {
  APPROACH_COPY,
  AUDIENCE_COPY,
  INTENT_COPY,
  LAYOUT_COPY,
  VOICE_COPY,
  localizeAxisOptions,
  localizeCreativeLens,
  localizePublishChannel,
} from '../components/StageContent/contentCopy';
import { translate } from '../services/i18n';

describe('Content Studio song ngữ', () => {
  const english = (key: Parameters<typeof translate>[1]) => translate('en', key);

  it('dịch nhãn bốn trục nhưng giữ nguyên value và directive tạo nội dung', () => {
    const localizedIntent = localizeAxisOptions(INTENT_OPTIONS, INTENT_COPY, english);
    const localizedApproach = localizeAxisOptions(APPROACH_OPTIONS, APPROACH_COPY, english);
    const localizedVoice = localizeAxisOptions(VOICE_OPTIONS, VOICE_COPY, english);
    const localizedAudience = localizeAxisOptions(AUDIENCE_OPTIONS, AUDIENCE_COPY, english);

    expect(localizedIntent.map((option) => option.value)).toEqual(INTENT_OPTIONS.map((option) => option.value));
    expect(localizedApproach.map((option) => option.value)).toEqual(APPROACH_OPTIONS.map((option) => option.value));
    expect(localizedVoice.map((option) => option.value)).toEqual(VOICE_OPTIONS.map((option) => option.value));
    expect(localizedAudience.map((option) => option.value)).toEqual(AUDIENCE_OPTIONS.map((option) => option.value));
    expect(localizedIntent.map((option) => option.directive)).toEqual(INTENT_OPTIONS.map((option) => option.directive));
    expect(localizedIntent[0].label).toBe('Build awareness');
  });

  it('dịch bố cục mà không đổi định danh HTML đã lưu', () => {
    expect(ARTICLE_LAYOUTS.map((option) => option.value)).toEqual(['editorial', 'minimal', 'card']);
    expect(translate('en', LAYOUT_COPY.editorial.label)).toBe('Editorial');
  });

  it('dịch hướng dẫn kênh đăng nhưng giữ nguyên endpoint và trường xác thực', () => {
    const source = PUBLISH_CHANNELS.find((channel) => channel.id === 'facebook-page')!;
    const localized = localizePublishChannel(source, 'en');

    expect(localized.proxyPrefix).toBe(source.proxyPrefix);
    expect(localized.fields.map((field) => field.key)).toEqual(source.fields.map((field) => field.key));
    expect(localized.steps[0]).toContain('developers.facebook.com');
    expect(localizePublishChannel(source, 'vi')).toBe(source);
  });

  it('dịch nhãn lăng kính nhưng giữ nguyên ID và directive đưa vào prompt', () => {
    const localized = CREATIVE_LENSES.map((lens) => localizeCreativeLens(lens, 'en'));

    expect(localized.map((lens) => lens.key)).toEqual(CREATIVE_LENSES.map((lens) => lens.key));
    expect(localized.flatMap((lens) => lens.options.map((option) => option.id))).toEqual(
      CREATIVE_LENSES.flatMap((lens) => lens.options.map((option) => option.id)),
    );
    expect(localized.flatMap((lens) => lens.options.map((option) => option.directive))).toEqual(
      CREATIVE_LENSES.flatMap((lens) => lens.options.map((option) => option.directive)),
    );
    expect(localized[0].label).toBe('Opening mechanism');
    expect(localized[0].options[0].label).toBe('Immediate benefit');
  });
});
