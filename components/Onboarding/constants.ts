// Cấu hình nội dung hướng dẫn bắt đầu.

export const ONBOARDING_STORAGE_KEY = 'egoric_studio_onboarding_completed';

export const ONBOARDING_PAGES = {
  WELCOME: 0,
  WORKFLOW: 1,
  HIGHLIGHTS: 2,
  API_KEY: 3,
  ACTION: 4,
} as const;

export const TOTAL_PAGES = 5;

// Các bước trong quy trình.
export const WORKFLOW_STEPS = [
  {
    number: '01',
    title: 'Sáng tạo kịch bản',
    description: 'AI tự động trích xuất nhân vật và bối cảnh',
  },
  {
    number: '02',
    title: 'Định hình nhân vật',
    description: 'Tạo ảnh ý tưởng nhân vật chỉ với một thao tác',
  },
  {
    number: '03',
    title: 'Casting giọng thoại',
    description: 'Dựng giọng Việt hoặc duyệt bản thu diễn viên thật',
  },
  {
    number: '04',
    title: 'Dựng bảng phân cảnh',
    description: 'Tạo video theo hệ thống khung hình chính',
  },
  {
    number: '05',
    title: 'Xuất thành phẩm',
    description: 'Ghép và xuất phim ngắn hoàn chỉnh',
  },
] as const;

// Điểm nổi bật của sản phẩm.
export const HIGHLIGHTS = [
  {
    title: 'Khóa khung hình đầu & cuối',
    description: 'Khung hình cuối của cảnh trước trở thành điểm bắt đầu của cảnh sau',
  },
  {
    title: 'Tủ trang phục nhân vật',
    description: 'Chuyển đổi linh hoạt nhiều tạo hình cho cùng một nhân vật',
  },
  {
    title: 'Phong cách nhất quán',
    description: 'Chọn phim người đóng, hoạt hình hoặc 3D và duy trì nhất quán toàn phim',
  },
  {
    title: 'Xưởng giọng Việt',
    description: 'Casting ba miền, nhiều take và luồng duyệt bản thu người thật',
  },
] as const;

// Tùy chọn bắt đầu nhanh.
export const QUICK_START_OPTIONS = [
  {
    id: 'script',
    title: 'Bắt đầu từ kịch bản',
    description: 'Dán câu chuyện, AI sẽ hỗ trợ chia cảnh',
  },
  {
    id: 'example',
    title: 'Xem dự án mẫu',
    description: 'Khám phá một quy trình có sẵn trước khi bắt đầu',
  },
] as const;
