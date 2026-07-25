import { TrendItem, TrendSource } from '../../types/content';
import { TREND_SOURCES, getTrendProxyUrl, getTrendSource } from './trendSources';

/**
 * Lấy và chuẩn hoá chủ đề nóng từ các nguồn Việt Nam.
 *
 * Phần đọc RSS tự cài đặt bằng biểu thức chính quy thay vì DOMParser, vì
 * DOMParser không có trong môi trường Node nên sẽ không kiểm thử được. RSS
 * đủ đơn giản để làm vậy an toàn: chỉ cần lấy <title> trong từng <item>.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (input: string): string =>
  input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);

/** Đuôi thương hiệu toà soạn hay bị gắn vào cuối tiêu đề RSS. */
const SITE_SUFFIX =
  /\s*[-–—|]\s*(VnExpress|Tuổi Trẻ Online|Tuoi Tre Online|Báo Thanh Niên|Thanh Niên|Báo Dân trí|Dân trí|Báo Người Lao Động|Người Lao Động|VietnamPlus|24H|Soha|Kenh14|CafeF)\s*$/i;

/**
 * Chuẩn hoá một tiêu đề thô thành chủ đề dùng được cho mô hình.
 *
 * Đổi `|` thành gạch ngang vì ký tự này vừa hay xuất hiện trong tiêu đề báo
 * vừa được dùng làm dấu phân cách ở chỗ khác trong ứng dụng.
 */
export const cleanTrendTitle = (raw: string): string =>
  decodeEntities(raw ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(SITE_SUFFIX, '')
    .replace(/\|/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();

const ITEM_BLOCK = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const LINK_TAG = /<link\b[^>]*>([\s\S]*?)<\/link>/i;
const DATE_TAG = /<(pubDate|published|updated)\b[^>]*>([\s\S]*?)<\/\1>/i;

interface ParsedEntry {
  title: string;
  link?: string;
  publishedAt?: string;
}

/** Bóc các mục của một feed RSS hoặc Atom. */
export const parseFeed = (xml: string, limit = 20): ParsedEntry[] => {
  const entries: ParsedEntry[] = [];
  const seen = new Set<string>();

  ITEM_BLOCK.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = ITEM_BLOCK.exec(xml)) !== null && entries.length < limit) {
    const inner = block[2];
    const title = cleanTrendTitle(TITLE_TAG.exec(inner)?.[1] ?? '');
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const link = cleanTrendTitle(LINK_TAG.exec(inner)?.[1] ?? '') || undefined;
    const publishedAt = cleanTrendTitle(DATE_TAG.exec(inner)?.[2] ?? '') || undefined;
    entries.push({ title, link, publishedAt });
  }

  return entries;
};

const toTrendItems = (source: TrendSource, entries: ParsedEntry[]): TrendItem[] =>
  entries.map((entry, index) => ({
    title: entry.title,
    sourceId: source.id,
    sourceLabel: source.label,
    category: source.category,
    rank: index + 1,
    link: entry.link,
    publishedAt: entry.publishedAt,
  }));

/** Đọc một nguồn. Trả về mảng rỗng nếu nguồn không phản hồi hoặc feed hỏng. */
export const fetchTrendSource = async (
  sourceId: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendItem[]> => {
  const source = getTrendSource(sourceId);
  if (!source) return [];

  try {
    const response = await fetchImpl(getTrendProxyUrl(sourceId));
    if (!response.ok) return [];
    const xml = await response.text();
    return toTrendItems(source, parseFeed(xml, limit));
  } catch {
    return [];
  }
};

/**
 * Đọc nguồn được yêu cầu, tự chuyển sang nguồn khác nếu nó chết.
 *
 * Một toà soạn hỏng feed không được phép làm gãy cả lượt sản xuất, nên thứ tự
 * dự phòng ưu tiên bảng xu hướng tìm kiếm rồi mới tới các nguồn nặng ký.
 */
export const fetchTrendsWithFallback = async (
  sourceId: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendItem[]> => {
  const primary = getTrendSource(sourceId);
  const fallbacks = [...TREND_SOURCES]
    .filter((source) => source.id !== sourceId)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'search' ? -1 : 1;
      return b.weight - a.weight;
    });

  for (const source of primary ? [primary, ...fallbacks] : fallbacks) {
    const items = await fetchTrendSource(source.id, limit, fetchImpl);
    if (items.length) return items;
  }

  return [];
};

/**
 * Rút thăm một chủ đề, hạng càng cao thì khả năng trúng càng lớn.
 *
 * Dùng `1/rank^2` để đầu bảng chiếm ưu thế rõ rệt mà đuôi vẫn có cửa — chạy
 * hằng ngày thì vẫn ra chủ đề khác nhau chứ không lặp mãi tin đầu tiên.
 */
export const pickWeightedTrend = (
  items: TrendItem[],
  random: () => number = Math.random,
): TrendItem | undefined => {
  if (!items.length) return undefined;

  const weights = items.map((item) => 1 / item.rank ** 2);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * total;

  for (let i = 0; i < items.length; i += 1) {
    threshold -= weights[i];
    if (threshold <= 0) return items[i];
  }

  return items[items.length - 1];
};

/** Gom nhiều nguồn lại, khử trùng lặp theo tiêu đề. */
export const fetchTrendBoard = async (
  sourceIds: string[],
  perSource = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<TrendItem[]> => {
  const batches = await Promise.all(
    sourceIds.map((id) => fetchTrendSource(id, perSource, fetchImpl)),
  );

  const seen = new Set<string>();
  const board: TrendItem[] = [];
  for (const item of batches.flat()) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    board.push(item);
  }

  return board;
};
