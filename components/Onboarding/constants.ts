// Onboarding 常量配置

export const ONBOARDING_STORAGE_KEY = 'egoric_studio_onboarding_completed';
export const LEGACY_ONBOARDING_STORAGE_KEY = ['big' + 'banana', 'onboarding', 'completed'].join('_');

export const ONBOARDING_PAGES = {
  WELCOME: 0,
  WORKFLOW: 1,
  HIGHLIGHTS: 2,
  API_KEY: 3,
  ACTION: 4,
} as const;

export const TOTAL_PAGES = 5;

// 工作流步骤
export const WORKFLOW_STEPS = [
  {
    number: '①',
    title: 'Sáng tạo kịch bản',
    description: 'AI tự động trích xuất nhân vật và bối cảnh',
  },
  {
    number: '②',
    title: 'Định hình nhân vật',
    description: 'Tạo ảnh concept nhân vật chỉ với một thao tác',
  },
  {
    number: '③',
    title: 'Dựng storyboard',
    description: 'Tạo video theo hệ thống keyframe',
  },
  {
    number: '④',
    title: 'Xuất thành phẩm',
    description: 'Ghép và xuất phim ngắn hoàn chỉnh',
  },
] as const;

// 核心亮点
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
    description: 'Chọn live-action, hoạt hình hoặc 3D và duy trì nhất quán toàn phim',
  },
] as const;

// 快速开始选项
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
