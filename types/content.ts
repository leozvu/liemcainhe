/**
 * Mô hình dữ liệu cho Xưởng Nội dung của Egoric Film Studio.
 *
 * Xưởng Nội dung bắt xu hướng Việt Nam, dựng brief, viết bài, và quan trọng
 * nhất là chuyển một chủ đề đang nóng thành đầu vào cho Phase 01 của xưởng
 * phim. Bài viết không phải đích đến cuối cùng mà là một nhánh song song với
 * kịch bản phim ngắn.
 */

/** Một nguồn xu hướng. `id` cũng là khoá tra cứu ở lớp proxy. */
export interface TrendSource {
  id: string;
  label: string;
  /** Tên miền đích. Chỉ lớp proxy dùng, trình duyệt không bao giờ gọi thẳng. */
  host: string;
  /** Đường dẫn feed trên tên miền đó. */
  path: string;
  category: TrendCategory;
  /** Trọng số khi rút thăm chủ đề. Tổng không cần bằng 1, hàm chọn sẽ chuẩn hoá. */
  weight: number;
  /**
   * `search` là bảng xu hướng tìm kiếm thật — tín hiệu mạnh nhất vì phản ánh
   * điều người ta đang chủ động tìm. `editorial` là dòng tin toà soạn đẩy ra.
   */
  kind: 'search' | 'editorial';
}

export type TrendCategory =
  | 'tong_hop'
  | 'giai_tri'
  | 'kinh_doanh'
  | 'cong_nghe'
  | 'doi_song';

/** Một chủ đề đang nóng, đã chuẩn hoá từ feed. */
export interface TrendItem {
  title: string;
  sourceId: string;
  sourceLabel: string;
  category: TrendCategory;
  /** Thứ hạng trong feed gốc, bắt đầu từ 1. */
  rank: number;
  link?: string;
  publishedAt?: string;
}

/**
 * Bốn trục điều khiển sáng tạo.
 *
 * Cố ý giữ nhỏ. Một ma trận hàng trăm lựa chọn nghe thì oai nhưng người làm
 * nội dung không dùng hết, còn tổ hợp ngẫu nhiên thì cho ra bài lai tạp. Bốn
 * trục dưới đây là bốn câu hỏi một người viết thật sự phải trả lời trước khi
 * đặt bút: viết để làm gì, vào bài bằng góc nào, giọng ra sao, nói với ai.
 */
export type ContentIntent =
  | 'awareness'
  | 'education'
  | 'conversion'
  | 'community';

export type ContentApproach =
  | 'story'
  | 'howto'
  | 'contrarian'
  | 'listicle'
  | 'casestudy'
  | 'mythbust'
  | 'explainer'
  | 'interview';

export type ContentVoice =
  | 'than_mat'
  | 'chuyen_gia'
  | 'hai_huoc'
  | 'truyen_cam'
  | 'sac_lanh'
  | 'moc_mac';

export type ContentAudience =
  | 'gen_z'
  | 'van_phong'
  | 'chu_doanh_nghiep'
  | 'phu_huynh'
  | 'ky_thuat'
  | 'pho_thong';

/** Một lựa chọn trên trục, kèm nhãn và mô tả để hiện lên giao diện. */
export interface AxisOption<T extends string> {
  value: T;
  label: string;
  description: string;
  /** Câu chỉ dẫn được ghép vào prompt. Đây là chỗ trục thực sự tác động. */
  directive: string;
}

/** Đầu vào đã chốt của một lượt sản xuất nội dung. */
export interface ContentBrief {
  topic: string;
  intent: ContentIntent;
  approach: ContentApproach;
  voice: ContentVoice;
  audience: ContentAudience;
  /** Từ khoá cần xuất hiện, phục vụ SEO. */
  keywords: string[];
  /** Ràng buộc riêng của khách hàng hoặc của chiến dịch. */
  notes?: string;
  /** Số chữ mong muốn của phần thân bài. */
  targetWords: number;
  /** Nguồn xu hướng đã sinh ra chủ đề này, nếu có. */
  origin?: Pick<TrendItem, 'sourceId' | 'sourceLabel' | 'link'>;
}

/** Một đoạn của bài viết. Tách đoạn để còn ánh xạ sang cảnh phim. */
export interface ArticleSection {
  heading: string;
  body: string;
}

/** Bài viết hoàn chỉnh do mô hình sinh ra. */
export interface ArticleDraft {
  title: string;
  /** Đoạn mở đầu in đậm dưới tiêu đề, quen gọi là sapo. */
  sapo: string;
  sections: ArticleSection[];
  hashtags: string[];
  seoTitle: string;
  metaDescription: string;
  /** Ước lượng thời gian đọc, tính bằng phút. */
  readingMinutes: number;
}

/** Kênh đăng bài. */
export type PublishChannelId = 'facebook-page' | 'threads' | 'zalo-oa';

/** Một ô thông tin đăng nhập mà người dùng phải tự điền. */
export interface CredentialField {
  key: 'accessToken' | 'accountId';
  label: string;
  /** Gợi ý ngay dưới ô nhập, nói rõ đây là thứ gì. */
  hint: string;
  secret: boolean;
}

export interface PublishChannel {
  id: PublishChannelId;
  label: string;
  /** Tiền tố proxy cùng miền mà trình duyệt gọi. */
  proxyPrefix: string;
  fields: CredentialField[];
  /** Trang lấy thông tin đăng nhập. */
  consoleUrl: string;
  /** Các bước lấy thông tin đăng nhập, hiện thẳng trong giao diện. */
  steps: string[];
  /** Điều kiện bắt buộc mà không có thì đăng sẽ hỏng. */
  requirements: string[];
  /** Điều cần biết trước khi đưa vào chạy thật. */
  caveat?: string;
}

export interface PublishCredentials {
  accessToken?: string;
  accountId?: string;
}

/** Nội dung đem đi đăng. Cùng một payload dùng cho mọi kênh. */
export interface PublishPayload {
  text: string;
  link?: string;
}

export interface PublishResult {
  channelId: PublishChannelId;
  success: boolean;
  message: string;
  postId?: string;
  url?: string;
  /**
   * Không xác định được kết quả: lệnh đã gửi đi nhưng không nhận được phản hồi,
   * thường do đứt mạng. Bài **có thể đã lên**.
   *
   * Khác hẳn thất bại thường. Thất bại là chắc chắn chưa lên nên đăng lại an
   * toàn; không xác định thì đăng lại có nguy cơ ra hai bài.
   */
  indeterminate?: boolean;
}

/**
 * Cầu nối sang xưởng phim.
 *
 * Đây là lý do Xưởng Nội dung tồn tại trong Egoric chứ không phải là một công
 * cụ viết bài rời rạc: cùng một chủ đề nóng, một nhánh ra bài đăng, một nhánh
 * ra kịch bản phim ngắn. Cấu trúc dưới đây khớp với `rawScript` và `ScriptData`
 * mà Phase 01 đang nhận.
 */
export interface StoryBridge {
  logline: string;
  /** Văn bản thô đổ thẳng vào ô nhập của Phase 01. */
  rawScript: string;
  /** Gợi ý thời lượng, dùng cho `targetDuration` của dự án phim. */
  suggestedDurationSeconds: number;
  /** Gợi ý phong cách hình ảnh, dùng cho `visualStyle`. */
  suggestedVisualStyle: string;
  characterHints: string[];
}
