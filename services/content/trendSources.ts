import { TrendSource } from '../../types/content';

/**
 * Danh mục nguồn xu hướng Việt Nam.
 *
 * File này là nguồn sự thật duy nhất cho cả hai phía: giao diện dùng nó để
 * hiện danh sách nguồn, còn lớp proxy dùng nó làm allowlist. Nhờ vậy trình
 * duyệt chỉ gửi lên một `id`, không bao giờ gửi URL đích — giữ đúng nguyên tắc
 * đã ghi trong docs/API_GATEWAY.vi.md là proxy không nhận đích từ người dùng.
 *
 * Toàn bộ endpoint dưới đây đều là feed RSS công khai, không cần khoá API.
 */
export const TREND_SOURCES: TrendSource[] = [
  {
    id: 'google-trends',
    label: 'Google Xu hướng',
    host: 'https://trends.google.com',
    path: '/trending/rss?geo=VN',
    category: 'tong_hop',
    weight: 0.24,
    kind: 'search',
  },
  {
    id: 'vnexpress',
    label: 'VnExpress',
    host: 'https://vnexpress.net',
    path: '/rss/tin-moi-nhat.rss',
    category: 'tong_hop',
    weight: 0.15,
    kind: 'editorial',
  },
  {
    id: 'dantri',
    label: 'Dân trí',
    host: 'https://dantri.com.vn',
    path: '/rss/home.rss',
    category: 'tong_hop',
    weight: 0.12,
    kind: 'editorial',
  },
  {
    id: 'tuoitre',
    label: 'Tuổi Trẻ',
    host: 'https://tuoitre.vn',
    path: '/rss/tin-moi-nhat.rss',
    category: 'tong_hop',
    weight: 0.1,
    kind: 'editorial',
  },
  {
    id: 'thanhnien',
    label: 'Thanh Niên',
    host: 'https://thanhnien.vn',
    path: '/rss/home.rss',
    category: 'tong_hop',
    weight: 0.08,
    kind: 'editorial',
  },
  {
    id: 'kenh14',
    label: 'Kenh14',
    host: 'https://kenh14.vn',
    path: '/star.rss',
    category: 'giai_tri',
    weight: 0.08,
    kind: 'editorial',
  },
  {
    id: 'soha',
    label: 'Soha',
    host: 'https://soha.vn',
    path: '/rss/home.rss',
    category: 'doi_song',
    weight: 0.05,
    kind: 'editorial',
  },
  {
    id: '24h',
    label: '24h',
    host: 'https://www.24h.com.vn',
    path: '/upload/rss/tintuctrongngay.rss',
    category: 'tong_hop',
    weight: 0.05,
    kind: 'editorial',
  },
  {
    id: 'nld',
    label: 'Người Lao Động',
    host: 'https://nld.com.vn',
    path: '/rss/home.rss',
    category: 'tong_hop',
    weight: 0.04,
    kind: 'editorial',
  },
  {
    id: 'vietnamplus',
    label: 'VietnamPlus',
    host: 'https://www.vietnamplus.vn',
    path: '/rss/tinmoinhat.rss',
    category: 'tong_hop',
    weight: 0.03,
    kind: 'editorial',
  },
  {
    id: 'tuoitre-giaitri',
    label: 'Tuổi Trẻ Giải trí',
    host: 'https://tuoitre.vn',
    path: '/rss/giai-tri.rss',
    category: 'giai_tri',
    weight: 0.03,
    kind: 'editorial',
  },
  {
    id: 'cafef',
    label: 'CafeF',
    host: 'https://cafef.vn',
    path: '/thi-truong-chung-khoan.rss',
    category: 'kinh_doanh',
    weight: 0.02,
    kind: 'editorial',
  },
  {
    id: 'vnexpress-congnghe',
    label: 'VnExpress Công nghệ',
    host: 'https://vnexpress.net',
    path: '/rss/khoa-hoc-cong-nghe.rss',
    category: 'cong_nghe',
    weight: 0.01,
    kind: 'editorial',
  },
];

/** Tiền tố proxy dành riêng cho feed xu hướng. */
export const TREND_PROXY_PREFIX = '/api-proxy/trends';

export const getTrendSource = (id: string): TrendSource | undefined =>
  TREND_SOURCES.find((source) => source.id === id);

/**
 * Dựng URL đích thật của một nguồn. Chỉ lớp proxy được gọi hàm này; phía trình
 * duyệt luôn đi qua `getTrendProxyUrl`.
 */
export const resolveTrendTargetUrl = (id: string): string | undefined => {
  const source = getTrendSource(id);
  return source ? `${source.host}${source.path}` : undefined;
};

/** Đường dẫn cùng miền mà trình duyệt gọi. */
export const getTrendProxyUrl = (id: string): string =>
  `${TREND_PROXY_PREFIX}/${encodeURIComponent(id)}`;
