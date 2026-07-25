import {
  ArticleDraft,
  PublishChannelId,
  PublishCredentials,
  PublishPayload,
  PublishResult,
} from '../../types/content';
import { getPublishChannel } from './publishChannels';

/**
 * Đăng bài lên các kênh nhận nội dung dạng chữ.
 *
 * Mọi kênh đi qua tiền tố proxy cùng miền, không gọi thẳng ra ngoài, cùng lý do
 * với lớp proxy xu hướng: CORS chặn, và không được để trình duyệt tự chọn đích.
 *
 * Không hàm nào ở đây tự chạy. Đăng bài là hành động không rút lại được nên
 * luôn phải do người dùng bấm.
 */

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Lỗi mạng không xác định';

/** Bóc thông báo lỗi của nhà cung cấp, vốn nằm ở vài chỗ khác nhau tuỳ nền tảng. */
const readError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return (
      data?.error?.message ||
      data?.error?.error_user_msg ||
      data?.message ||
      data?.error_description ||
      `Lỗi HTTP ${response.status}`
    );
  } catch {
    return `Lỗi HTTP ${response.status}`;
  }
};

/**
 * Rút gọn bài viết thành một bài đăng.
 *
 * Bài viết dài không đăng nguyên si được, mà cắt cụt giữa câu thì đọc rất tệ.
 * Nên cắt ở ranh giới câu gần nhất còn nằm trong giới hạn.
 */
export const toPostText = (draft: ArticleDraft, limit: number): string => {
  const full = [draft.sapo, ...draft.sections.map((section) => section.body)]
    .filter(Boolean)
    .join('\n\n');
  const head = `${draft.title}\n\n${full}`;
  const tags = draft.hashtags.length ? `\n\n${draft.hashtags.map((t) => `#${t}`).join(' ')}` : '';

  const room = limit - tags.length;
  if (head.length <= room) return head + tags;

  const cut = head.slice(0, room);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('…'));

  // Nhánh thêm dấu ba chấm phải cắt ngắn thêm một ký tự, nếu không chính dấu
  // đó lại đẩy tổng vượt giới hạn.
  const body =
    lastStop > room * 0.5
      ? cut.slice(0, lastStop + 1)
      : `${head.slice(0, Math.max(0, room - 1)).trimEnd()}…`;

  return body + tags;
};

/** Giới hạn ký tự của từng kênh. */
export const CHANNEL_LIMITS: Record<PublishChannelId, number> = {
  'facebook-page': 60000,
  threads: 500,
  'zalo-oa': 20000,
};

type Fetcher = typeof fetch;

const publishFacebookPage = async (
  payload: PublishPayload,
  credentials: PublishCredentials,
  fetchImpl: Fetcher,
): Promise<PublishResult> => {
  const body = new URLSearchParams({
    message: payload.text,
    access_token: credentials.accessToken ?? '',
  });
  if (payload.link) body.set('link', payload.link);

  const response = await fetchImpl(
    `/api-proxy/facebook/v21.0/${encodeURIComponent(credentials.accountId ?? '')}/feed`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  );

  if (!response.ok) {
    return { channelId: 'facebook-page', success: false, message: await readError(response) };
  }

  const data = await response.json();
  const postId = data?.id as string | undefined;
  return {
    channelId: 'facebook-page',
    success: true,
    message: 'Đã đăng lên Trang.',
    postId,
    url: postId ? `https://facebook.com/${postId}` : undefined,
  };
};

/**
 * Threads đăng qua hai bước: tạo vùng chứa rồi mới xuất bản.
 *
 * Bước một hỏng thì chưa có gì lên mạng. Bước hai hỏng thì vùng chứa còn treo
 * lại nhưng không hiện ra công khai, nên báo lỗi là an toàn.
 */
const publishThreads = async (
  payload: PublishPayload,
  credentials: PublishCredentials,
  fetchImpl: Fetcher,
): Promise<PublishResult> => {
  const userId = encodeURIComponent(credentials.accountId ?? '');
  const token = credentials.accessToken ?? '';

  const createBody = new URLSearchParams({
    media_type: 'TEXT',
    text: payload.text,
    access_token: token,
  });
  if (payload.link) createBody.set('link_attachment', payload.link);

  const created = await fetchImpl(`/api-proxy/threads/v1.0/${userId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createBody,
  });

  if (!created.ok) {
    return {
      channelId: 'threads',
      success: false,
      message: `Không tạo được bài nháp: ${await readError(created)}`,
    };
  }

  const creationId = (await created.json())?.id;
  if (!creationId) {
    return { channelId: 'threads', success: false, message: 'Threads không trả về mã bài nháp.' };
  }

  const published = await fetchImpl(`/api-proxy/threads/v1.0/${userId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: String(creationId), access_token: token }),
  });

  if (!published.ok) {
    return {
      channelId: 'threads',
      success: false,
      message: `Đã tạo bài nháp nhưng không xuất bản được: ${await readError(published)}. Bài nháp không hiện công khai.`,
    };
  }

  const postId = (await published.json())?.id as string | undefined;
  return { channelId: 'threads', success: true, message: 'Đã đăng lên Threads.', postId };
};

const publishZaloOa = async (
  payload: PublishPayload,
  credentials: PublishCredentials,
  fetchImpl: Fetcher,
): Promise<PublishResult> => {
  const response = await fetchImpl('/api-proxy/zalo/v2.0/article/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      access_token: credentials.accessToken ?? '',
    },
    body: JSON.stringify({
      type: 'normal',
      body: [{ type: 'text', content: payload.text }],
      status: 'show',
    }),
  });

  if (!response.ok) {
    return { channelId: 'zalo-oa', success: false, message: await readError(response) };
  }

  const data = await response.json();
  // Zalo trả HTTP 200 kèm mã lỗi trong thân phản hồi, khác với hai kênh còn lại.
  if (data?.error && data.error !== 0) {
    return {
      channelId: 'zalo-oa',
      success: false,
      message: data.message || `Zalo trả mã lỗi ${data.error}`,
    };
  }

  return {
    channelId: 'zalo-oa',
    success: true,
    message: 'Đã đăng lên Official Account.',
    postId: data?.data?.id,
  };
};

const ADAPTERS: Record<
  PublishChannelId,
  (p: PublishPayload, c: PublishCredentials, f: Fetcher) => Promise<PublishResult>
> = {
  'facebook-page': publishFacebookPage,
  threads: publishThreads,
  'zalo-oa': publishZaloOa,
};

/** Kiểm tra đủ thông tin đăng nhập chưa. Trả về danh sách ô còn thiếu. */
export const findMissingCredentials = (
  channelId: PublishChannelId,
  credentials: PublishCredentials,
): string[] => {
  const channel = getPublishChannel(channelId);
  if (!channel) return ['Kênh không hợp lệ'];
  return channel.fields
    .filter((field) => !credentials[field.key]?.trim())
    .map((field) => field.label);
};

export const publishToChannel = async (
  channelId: PublishChannelId,
  payload: PublishPayload,
  credentials: PublishCredentials,
  fetchImpl: Fetcher = fetch,
): Promise<PublishResult> => {
  const adapter = ADAPTERS[channelId];
  if (!adapter) {
    return { channelId, success: false, message: `Kênh chưa được hỗ trợ: ${channelId}` };
  }

  const missing = findMissingCredentials(channelId, credentials);
  if (missing.length) {
    return { channelId, success: false, message: `Còn thiếu: ${missing.join(', ')}.` };
  }

  if (!payload.text.trim()) {
    return { channelId, success: false, message: 'Nội dung rỗng, không có gì để đăng.' };
  }

  const limit = CHANNEL_LIMITS[channelId];
  if (payload.text.length > limit) {
    return {
      channelId,
      success: false,
      message: `Nội dung ${payload.text.length} ký tự, vượt giới hạn ${limit} của kênh này.`,
    };
  }

  try {
    return await adapter(payload, credentials, fetchImpl);
  } catch (error) {
    return { channelId, success: false, message: asMessage(error) };
  }
};
