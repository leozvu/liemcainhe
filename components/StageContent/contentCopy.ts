import {
  AxisOption,
  ContentApproach,
  ContentAudience,
  ContentIntent,
  ContentVoice,
  PublishChannel,
  PublishChannelId,
} from '../../types/content';
import { AppLocale, TranslationKey } from '../../services/i18n';
import { ArticleLayout } from '../../services/content/articleHtmlService';

type AxisCopy = { label: TranslationKey; description: TranslationKey };

export const INTENT_COPY: Record<ContentIntent, AxisCopy> = {
  awareness: { label: 'content.axis.intent.awareness', description: 'content.axis.intent.awarenessDetail' },
  education: { label: 'content.axis.intent.education', description: 'content.axis.intent.educationDetail' },
  conversion: { label: 'content.axis.intent.conversion', description: 'content.axis.intent.conversionDetail' },
  community: { label: 'content.axis.intent.community', description: 'content.axis.intent.communityDetail' },
};

export const APPROACH_COPY: Record<ContentApproach, AxisCopy> = {
  story: { label: 'content.axis.approach.story', description: 'content.axis.approach.storyDetail' },
  howto: { label: 'content.axis.approach.howto', description: 'content.axis.approach.howtoDetail' },
  contrarian: { label: 'content.axis.approach.contrarian', description: 'content.axis.approach.contrarianDetail' },
  listicle: { label: 'content.axis.approach.listicle', description: 'content.axis.approach.listicleDetail' },
  casestudy: { label: 'content.axis.approach.casestudy', description: 'content.axis.approach.casestudyDetail' },
  mythbust: { label: 'content.axis.approach.mythbust', description: 'content.axis.approach.mythbustDetail' },
  explainer: { label: 'content.axis.approach.explainer', description: 'content.axis.approach.explainerDetail' },
  interview: { label: 'content.axis.approach.interview', description: 'content.axis.approach.interviewDetail' },
};

export const VOICE_COPY: Record<ContentVoice, AxisCopy> = {
  than_mat: { label: 'content.axis.voice.friendly', description: 'content.axis.voice.friendlyDetail' },
  chuyen_gia: { label: 'content.axis.voice.expert', description: 'content.axis.voice.expertDetail' },
  hai_huoc: { label: 'content.axis.voice.humorous', description: 'content.axis.voice.humorousDetail' },
  truyen_cam: { label: 'content.axis.voice.emotive', description: 'content.axis.voice.emotiveDetail' },
  sac_lanh: { label: 'content.axis.voice.direct', description: 'content.axis.voice.directDetail' },
  moc_mac: { label: 'content.axis.voice.plain', description: 'content.axis.voice.plainDetail' },
};

export const AUDIENCE_COPY: Record<ContentAudience, AxisCopy> = {
  gen_z: { label: 'content.axis.audience.genZ', description: 'content.axis.audience.genZDetail' },
  van_phong: { label: 'content.axis.audience.office', description: 'content.axis.audience.officeDetail' },
  chu_doanh_nghiep: { label: 'content.axis.audience.owner', description: 'content.axis.audience.ownerDetail' },
  phu_huynh: { label: 'content.axis.audience.parents', description: 'content.axis.audience.parentsDetail' },
  ky_thuat: { label: 'content.axis.audience.technical', description: 'content.axis.audience.technicalDetail' },
  pho_thong: { label: 'content.axis.audience.general', description: 'content.axis.audience.generalDetail' },
};

export const LAYOUT_COPY: Record<ArticleLayout, AxisCopy> = {
  editorial: { label: 'content.layout.editorial', description: 'content.layout.editorialDetail' },
  minimal: { label: 'content.layout.minimal', description: 'content.layout.minimalDetail' },
  card: { label: 'content.layout.card', description: 'content.layout.cardDetail' },
};

export const localizeAxisOptions = <T extends string>(
  options: AxisOption<T>[],
  copy: Record<T, AxisCopy>,
  t: (key: TranslationKey) => string,
): AxisOption<T>[] => options.map((option) => ({
  ...option,
  label: t(copy[option.value].label),
  description: t(copy[option.value].description),
}));

type PublishChannelCopy = Pick<PublishChannel, 'fields' | 'steps' | 'requirements' | 'caveat'>;

const ENGLISH_PUBLISH_CHANNEL_COPY: Record<PublishChannelId, PublishChannelCopy> = {
  'facebook-page': {
    fields: [
      { key: 'accountId', label: 'Page ID', hint: 'The numeric Page identifier in Meta Business Suite → Page settings.', secret: false },
      { key: 'accessToken', label: 'Page Access Token', hint: 'Use a Page token, not a user token. A long-lived token is recommended.', secret: true },
    ],
    steps: [
      'Open developers.facebook.com and create a Business app.',
      'Add Facebook Login and request pages_manage_posts plus pages_read_engagement.',
      'Open Graph API Explorer, select the app, then select your Page.',
      'Choose Generate Access Token, approve the permissions, and copy the token.',
      'Use Access Token Debugger → Extend Access Token to create a long-lived token.',
      'Find the Page ID in Meta Business Suite → Page settings.',
    ],
    requirements: [
      'You must be an administrator of the Page.',
      'A user token cannot publish here. Use the token for that specific Page.',
    ],
    caveat: 'A long-lived Page token can still expire after a password change or when app permissions are removed. Publishing to client Pages outside your organization requires Meta app review.',
  },
  threads: {
    fields: [
      { key: 'accountId', label: 'Threads User ID', hint: 'The Threads account identifier returned by the Threads API /me endpoint.', secret: false },
      { key: 'accessToken', label: 'Threads Access Token', hint: 'A Threads-specific token, separate from the Facebook token.', secret: true },
    ],
    steps: [
      'Open developers.facebook.com, create an app, and add the Threads API product.',
      'Enable threads_basic and threads_content_publish in the Threads API settings.',
      'Open Threads Graph API Explorer and select your Threads account.',
      'Choose Generate Access Token and copy the token.',
      'Call /v1.0/me with that token to retrieve the Threads User ID.',
    ],
    requirements: [
      'The Threads account must be linked to a professional Instagram account.',
      'Text publishing uses two steps: create a container, then publish it.',
    ],
    caveat: 'Threads limits each account to 250 posts per 24-hour period.',
  },
  'zalo-oa': {
    fields: [
      { key: 'accessToken', label: 'OA Access Token', hint: 'The Official Account token expires after 25 hours and must be refreshed with a refresh token.', secret: true },
    ],
    steps: [
      'Open developers.zalo.me, create an app, and link it to your Official Account.',
      'Enable article management in the Official Account API settings.',
      'Run the OAuth flow, then exchange the authorization code for an access token and refresh token.',
      'Store the refresh token safely because the access token lasts only 25 hours.',
    ],
    requirements: [
      'The Official Account must be verified before it can publish through the API.',
      'The app must be linked to the same Official Account.',
    ],
    caveat: 'The access token expires after 25 hours. This version does not refresh it automatically; paste a new token after expiry. Automatic refresh requires secure server-side refresh-token storage.',
  },
};

export const localizePublishChannel = (channel: PublishChannel, locale: AppLocale): PublishChannel =>
  locale === 'en' ? { ...channel, ...ENGLISH_PUBLISH_CHANNEL_COPY[channel.id] } : channel;
