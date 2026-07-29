import { PostInsights, PublishChannelId, PublishCredentials } from '../../types/content';
import { AppLocale, intlLocale } from '../i18n';

/**
 * Thu số liệu hiệu quả của bài đã đăng.
 *
 * Đây là mảnh còn thiếu để bàn duyệt quyết nhanh: thấy ngay "bài tương tự đạt
 * bao nhiêu" thì quyết trong năm giây thay vì năm phút. Không có nó thì mọi
 * thứ tự động về sau đều mù — sản xuất mà không biết cái gì hiệu quả.
 *
 * Nguyên tắc: thiếu số nào thì không hiện số đó. Không đoán, không quy về 0.
 * Không đọc được lượt xem khác hẳn với lượt xem bằng 0.
 */

const asNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type Fetcher = typeof fetch;

const readError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `Lỗi HTTP ${response.status}`;
  } catch {
    return `Lỗi HTTP ${response.status}`;
  }
};

/**
 * Bóc số liệu từ khối `insights` của Meta.
 *
 * Dạng trả về là mảng các metric, mỗi metric có mảng `values`, giá trị mới
 * nhất nằm ở phần tử cuối.
 */
export const readMetaInsightValues = (payload: unknown): Record<string, number> => {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return {};

  const result: Record<string, number> = {};
  for (const entry of data) {
    const row = entry as { name?: unknown; values?: unknown };
    const name = typeof row.name === 'string' ? row.name : undefined;
    if (!name || !Array.isArray(row.values) || !row.values.length) continue;
    const last = row.values[row.values.length - 1] as { value?: unknown };
    const value = asNumber(last?.value);
    if (value !== undefined) result[name] = value;
  }
  return result;
};

const fetchFacebookInsights = async (
  postId: string,
  credentials: PublishCredentials,
  fetchImpl: Fetcher,
): Promise<PostInsights> => {
  const base: PostInsights = { channelId: 'facebook-page', postId, fetchedAt: Date.now() };
  const token = encodeURIComponent(credentials.accessToken ?? '');

  // Hai lời gọi vì Meta tách số hiển thị (insights) khỏi số tương tác (edges).
  const [insightsRes, edgesRes] = await Promise.all([
    fetchImpl(
      `/api-proxy/facebook/v21.0/${encodeURIComponent(postId)}/insights` +
        `?metric=post_impressions,post_impressions_unique,post_engaged_users&access_token=${token}`,
    ),
    fetchImpl(
      `/api-proxy/facebook/v21.0/${encodeURIComponent(postId)}` +
        `?fields=shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)&access_token=${token}`,
    ),
  ]);

  if (!insightsRes.ok && !edgesRes.ok) {
    return { ...base, unavailable: await readError(insightsRes) };
  }

  if (insightsRes.ok) {
    const metrics = readMetaInsightValues(await insightsRes.json());
    base.impressions = metrics.post_impressions;
    base.reach = metrics.post_impressions_unique;
    base.engagements = metrics.post_engaged_users;
  }

  if (edgesRes.ok) {
    const payload = (await edgesRes.json()) as Record<string, any>;
    base.likes = asNumber(payload?.reactions?.summary?.total_count);
    base.comments = asNumber(payload?.comments?.summary?.total_count);
    base.shares = asNumber(payload?.shares?.count);
  }

  return base;
};

const fetchThreadsInsights = async (
  postId: string,
  credentials: PublishCredentials,
  fetchImpl: Fetcher,
): Promise<PostInsights> => {
  const base: PostInsights = { channelId: 'threads', postId, fetchedAt: Date.now() };
  const token = encodeURIComponent(credentials.accessToken ?? '');

  const response = await fetchImpl(
    `/api-proxy/threads/v1.0/${encodeURIComponent(postId)}/insights` +
      `?metric=views,likes,replies,reposts&access_token=${token}`,
  );

  if (!response.ok) return { ...base, unavailable: await readError(response) };

  const metrics = readMetaInsightValues(await response.json());
  return {
    ...base,
    impressions: metrics.views,
    likes: metrics.likes,
    comments: metrics.replies,
    shares: metrics.reposts,
  };
};

/**
 * Zalo OA không mở API đọc số liệu bài viết cho ứng dụng bên thứ ba.
 *
 * Trả về lý do rõ ràng thay vì im lặng, để giao diện nói được vì sao trống
 * thay vì để người dùng tưởng hệ thống hỏng.
 */
const zaloUnavailable = (postId: string): PostInsights => ({
  channelId: 'zalo-oa',
  postId,
  fetchedAt: Date.now(),
  unavailable: 'Zalo OA không mở API đọc số liệu bài viết. Xem trong trang quản trị OA.',
});

export interface FetchInsightsOptions {
  fetchImpl?: Fetcher;
}

export const fetchPostInsights = async (
  channelId: PublishChannelId,
  postId: string,
  credentials: PublishCredentials,
  options: FetchInsightsOptions = {},
): Promise<PostInsights> => {
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!postId.trim()) {
    return { channelId, postId, fetchedAt: Date.now(), unavailable: 'Bài chưa có mã định danh.' };
  }
  if (!credentials.accessToken?.trim()) {
    return { channelId, postId, fetchedAt: Date.now(), unavailable: 'Chưa có token để đọc số liệu.' };
  }

  try {
    if (channelId === 'facebook-page') return await fetchFacebookInsights(postId, credentials, fetchImpl);
    if (channelId === 'threads') return await fetchThreadsInsights(postId, credentials, fetchImpl);
    return zaloUnavailable(postId);
  } catch (error) {
    return {
      channelId,
      postId,
      fetchedAt: Date.now(),
      unavailable: error instanceof Error ? error.message : 'Không đọc được số liệu.',
    };
  }
};

/** Có số liệu dùng được không, hay chỉ là bản ghi trống. */
export const hasMetrics = (insights?: PostInsights | null): boolean =>
  Boolean(
    insights &&
      !insights.unavailable &&
      [insights.impressions, insights.reach, insights.likes, insights.comments, insights.shares, insights.engagements]
        .some((value) => value !== undefined),
  );

/**
 * Tổng tương tác, ưu tiên con số nền tảng tự tính.
 *
 * Meta có `post_engaged_users` là số người tương tác, chính xác hơn tổng thủ
 * công vì một người bấm nhiều nút chỉ tính một lần.
 */
export const totalEngagements = (insights: PostInsights): number | undefined => {
  if (insights.engagements !== undefined) return insights.engagements;
  const parts = [insights.likes, insights.comments, insights.shares].filter(
    (value): value is number => value !== undefined,
  );
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : undefined;
};

/** Tỷ lệ tương tác trên số người tiếp cận, đơn vị phần trăm. */
export const engagementRate = (insights: PostInsights): number | undefined => {
  const engaged = totalEngagements(insights);
  const base = insights.reach ?? insights.impressions;
  if (engaged === undefined || !base) return undefined;
  return Math.round((engaged / base) * 1000) / 10;
};

/** Một dòng tóm tắt để hiện trong danh sách. */
export const describeInsights = (insights: PostInsights, locale: AppLocale = 'vi'): string => {
  if (insights.unavailable) return insights.unavailable;

  const parts: string[] = [];
  const localeTag = intlLocale(locale);
  if (insights.reach !== undefined) {
    parts.push(`${insights.reach.toLocaleString(localeTag)} ${locale === 'en' ? 'reach' : 'người tiếp cận'}`);
  } else if (insights.impressions !== undefined) {
    parts.push(`${insights.impressions.toLocaleString(localeTag)} ${locale === 'en' ? 'impressions' : 'lượt hiển thị'}`);
  }

  const engaged = totalEngagements(insights);
  if (engaged !== undefined) parts.push(`${engaged.toLocaleString(localeTag)} ${locale === 'en' ? 'engagements' : 'tương tác'}`);

  const rate = engagementRate(insights);
  if (rate !== undefined) parts.push(`${rate}%`);

  return parts.length ? parts.join(' · ') : locale === 'en' ? 'No insights yet' : 'Chưa có số liệu';
};
