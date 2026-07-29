import {
  AxisOption,
  ContentApproach,
  ContentAudience,
  ContentIntent,
  ContentVoice,
  CreativeDirection,
  CreativeLensKey,
  PublishChannel,
  PublishChannelId,
} from '../../types/content';
import { AppLocale, TranslationKey } from '../../services/i18n';
import { ArticleLayout } from '../../services/content/articleHtmlService';
import { CreativeLens, CreativeLensOption } from '../../services/content/creativeDirectionService';

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

type EnglishLensCopy = {
  label: string;
  description: string;
  options: Record<string, { label: string; description: string }>;
};

const ENGLISH_LENS_COPY: Record<CreativeLensKey, EnglishLensCopy> = {
  hook: {
    label: 'Opening mechanism', description: 'Why the audience stops in the first two lines.', options: {
      'loi-ich-ngay': { label: 'Immediate benefit', description: 'Lead with the result the audience wants.' },
      'khoang-trong': { label: 'Curiosity gap', description: 'Reveal what matters without giving everything away.' },
      'cau-hoi-that': { label: 'Real question', description: 'Ask what the customer is already wondering.' },
      'chi-tiet-la': { label: 'Unexpected detail', description: 'Open with an image or fact that is hard to ignore.' },
    },
  },
  tension: {
    label: 'Tension', description: 'The conflict that keeps the audience engaged.', options: {
      'mong-muon-thuc-te': { label: 'Desire vs. reality', description: 'The gap between the wanted and current state.' },
      'duoc-mat': { label: 'Gain vs. loss', description: 'A choice with a clear tradeoff.' },
      'cu-moi': { label: 'Old vs. new', description: 'Challenge a familiar habit.' },
      'noi-lam': { label: 'Words vs. actions', description: 'Expose the gap between claims and behavior.' },
    },
  },
  proof: {
    label: 'Proof mechanism', description: 'Evidence that makes the message credible.', options: {
      'minh-hoa': { label: 'Live demonstration', description: 'Show the process and outcome.' },
      'tinh-huong': { label: 'Real-world case', description: 'A situation with context and an outcome.' },
      'so-sanh': { label: 'Like-for-like comparison', description: 'Compare options against the same criteria.' },
      'du-lieu-than-trong': { label: 'Careful use of data', description: 'Use sourced figures or qualified claims.' },
    },
  },
  emotion: {
    label: 'Emotional arc', description: 'The audience’s emotional journey from start to finish.', options: {
      'dong-cam-hy-vong': { label: 'Empathy → hope', description: 'Feel understood, then see a way forward.' },
      'to-mo-vo-le': { label: 'Curiosity → insight', description: 'Discover a hidden mechanism.' },
      'ap-luc-nhe-nhom': { label: 'Pressure → relief', description: 'Resolve one specific concern.' },
      'bat-ngo-ro-rang': { label: 'Surprise → clarity', description: 'Reverse expectations, then explain why.' },
    },
  },
  narrator: {
    label: 'Narrator role', description: 'Who guides the audience through the story.', options: {
      'nguoi-trong-cuoc': { label: 'Insider', description: 'Tell it from direct experience.' },
      'khach-hang': { label: 'Customer perspective', description: 'Follow the decision journey.' },
      'chuyen-gia-dan-duong': { label: 'Expert guide', description: 'Explain calmly without lecturing.' },
      'quan-sat-vien': { label: 'Observer', description: 'Take a wider, more detached view.' },
    },
  },
  culture: {
    label: 'Vietnamese context', description: 'Cultural detail that makes the work feel close and authentic.', options: {
      'do-thi-duong-dai': { label: 'Contemporary city life', description: 'Present-day urban life in Vietnam.' },
      'gia-dinh': { label: 'Multigenerational family', description: 'Decisions shaped by close family.' },
      'kinh-doanh-dia-phuong': { label: 'Local business', description: 'The reality of Vietnamese shops and companies.' },
      'cong-so': { label: 'Workplace culture', description: 'Familiar tensions at work.' },
    },
  },
  time: {
    label: 'Time frame', description: 'How time structures the story.', options: {
      'mot-ngay': { label: 'A typical day', description: 'Follow the character through one day.' },
      'truoc-sau': { label: 'Before and after', description: 'Make the change visible.' },
      'ngay-luc-nay': { label: 'Right now', description: 'Focus on what matters today.' },
      'tuong-lai-gan': { label: 'Near future', description: 'A realistic future worth acting on.' },
    },
  },
  setting: {
    label: 'Primary setting', description: 'Where the story happens and can realistically be filmed.', options: {
      'ban-lam-viec': { label: 'Desk', description: 'Compact, intimate, and action-focused.' },
      'cua-hang': { label: 'Shop or studio', description: 'Product and direct interaction in one place.' },
      'duong-pho': { label: 'Vietnamese street', description: 'Everyday energy and movement.' },
      'khong-gian-nha': { label: 'Home', description: 'Intimate and suited to personal stories.' },
    },
  },
  format: {
    label: 'Expression format', description: 'How the audience experiences the content.', options: {
      'nhat-ky': { label: 'Short diary', description: 'A personal sequence of events.' },
      'kiem-chung': { label: 'Test and verify', description: 'Set a hypothesis, then test it.' },
      'doi-thoai': { label: 'Dialogue', description: 'Let two perspectives meet.' },
      'cam-nang': { label: 'Action guide', description: 'Clear steps worth saving.' },
    },
  },
  structure: {
    label: 'Structure', description: 'The framework that keeps the content logical.', options: {
      'van-de-giai-phap': { label: 'Problem → solution', description: 'Move directly from pain point to resolution.' },
      'mo-vong-ket-vong': { label: 'Open loop → close loop', description: 'Bring the opening detail back at the end.' },
      'ba-tang': { label: 'Fact → meaning → action', description: 'Move from information to a decision.' },
      'so-sanh-quyet-dinh': { label: 'Compare → decide', description: 'Help the audience choose between options.' },
    },
  },
  rhythm: {
    label: 'Content rhythm', description: 'The speed and density of ideas.', options: {
      'nhanh-gon': { label: 'Fast and concise', description: 'Short sections and quick transitions.' },
      'can-bang': { label: 'Balanced', description: 'Fast enough to hold attention, deep enough to trust.' },
      'tang-dan': { label: 'Escalating', description: 'Make each section stronger than the last.' },
      'dien-anh': { label: 'Cinematic slow burn', description: 'Fewer ideas with richer visual detail.' },
    },
  },
  language: {
    label: 'Language texture', description: 'How the writing creates a brand feeling.', options: {
      'doi-thuong': { label: 'Natural Vietnamese', description: 'Conversational and never machine-translated.' },
      'bien-tap': { label: 'Premium editorial', description: 'Clean, confident, and restrained.' },
      'dam-chat-social': { label: 'Social-first', description: 'Short, direct, and speech-like.' },
      'goi-hinh': { label: 'Controlled imagery', description: 'Cinematic without becoming overwrought.' },
    },
  },
  perspective: {
    label: 'Point of view', description: 'The distance between the content and its audience.', options: {
      'toi': { label: 'First person', description: 'Close and accountable to personal experience.' },
      'ban': { label: 'Direct address', description: 'Personalized and action-oriented.' },
      'nhan-vat': { label: 'Follow one character', description: 'See the story through one character’s choices.' },
      'da-goc': { label: 'Multiple perspectives', description: 'One issue viewed by several stakeholders.' },
    },
  },
  participation: {
    label: 'Post-content action', description: 'What the audience is invited to do next.', options: {
      'binh-luan': { label: 'Share an experience', description: 'Start a genuine conversation.' },
      'luu-lai': { label: 'Save for later', description: 'Create lasting reference value.' },
      'chia-se': { label: 'Share with the right person', description: 'Make it useful to a clearly defined group.' },
      'nhan-tin': { label: 'Message for advice', description: 'Move gently into a private conversation.' },
    },
  },
  visualMotif: {
    label: 'Visual motif', description: 'One visual rule that keeps every scene coherent.', options: {
      'mot-vat-the': { label: 'Recurring object', description: 'A familiar object connects the opening and ending.' },
      'doi-tay': { label: 'Hands at work', description: 'Real action instead of posing.' },
      'bien-doi-khong-gian': { label: 'Transforming space', description: 'Make the before-and-after state visible.' },
      'chi-tiet-chat-lieu': { label: 'Material detail', description: 'Close-ups that create a premium feel.' },
    },
  },
};

const ENGLISH_DIRECTION_COPY: Record<string, Pick<CreativeDirection, 'name' | 'promise' | 'rationale'>> = {
  'su-that-huu-ich': {
    name: 'Useful truth',
    promise: 'Turn a timely topic into credible content worth saving.',
    rationale: 'Best when the audience needs evidence and clarity before they trust the message.',
  },
  'nguoi-that-chuyen-that': {
    name: 'Real people, real stories',
    promise: 'Carry the message through an emotional journey that can be filmed.',
    rationale: 'Makes the audience remember a human situation instead of information alone.',
  },
  'goc-nhin-nguoc': {
    name: 'Counterpoint',
    promise: 'Create evidence-based tension without resorting to clickbait.',
    rationale: 'Useful when the work needs to stop the scroll and invite thoughtful discussion.',
  },
  'tu-van-de-den-hanh-dong': {
    name: 'Problem to action',
    promise: 'Remove a barrier and guide the audience to one clear next step.',
    rationale: 'Prioritizes practical results while avoiding inflated promises.',
  },
  'chat-viet-duong-dai': {
    name: 'Contemporary Vietnam',
    promise: 'Feel unmistakably Vietnamese without relying on tourism clichés.',
    rationale: 'Fits work that needs authentic present-day settings, imagery, and language.',
  },
};

export const localizeCreativeLens = (lens: CreativeLens, locale: AppLocale): CreativeLens => {
  if (locale === 'vi') return lens;
  const copy = ENGLISH_LENS_COPY[lens.key];
  return {
    ...lens,
    label: copy.label,
    description: copy.description,
    options: lens.options.map((option) => ({ ...option, ...(copy.options[option.id] ?? {}) })),
  };
};

export const localizeCreativeLensOption = (
  lens: CreativeLens,
  option: CreativeLensOption,
  locale: AppLocale,
): CreativeLensOption => locale === 'en'
  ? { ...option, ...(ENGLISH_LENS_COPY[lens.key].options[option.id] ?? {}) }
  : option;

export const localizeCreativeDirection = (
  direction: CreativeDirection,
  locale: AppLocale,
): CreativeDirection => locale === 'en' && ENGLISH_DIRECTION_COPY[direction.id]
  ? { ...direction, ...ENGLISH_DIRECTION_COPY[direction.id] }
  : direction;
