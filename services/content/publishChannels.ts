import { PublishChannel } from '../../types/content';

/**
 * Danh mục kênh đăng bài.
 *
 * Phần `steps` và `requirements` không phải tài liệu cho lập trình viên mà hiện
 * thẳng trong giao diện. Lấy được token của ba nền tảng này là việc rắc rối và
 * hay đổi; để người dùng phải mở tab khác đi tra là chỗ họ sẽ bỏ cuộc.
 *
 * Ba kênh dưới đây đều nhận nội dung dạng chữ nên hợp với đầu ra của Xưởng Nội
 * dung. TikTok và YouTube không có ở đây vì chúng nhận video — đó là đầu ra của
 * Phase 04, một đường ống khác.
 */
export const PUBLISH_CHANNELS: PublishChannel[] = [
  {
    id: 'facebook-page',
    label: 'Facebook Page',
    proxyPrefix: '/api-proxy/facebook',
    fields: [
      {
        key: 'accountId',
        label: 'Page ID',
        hint: 'Dãy số định danh Trang. Xem trong Meta Business Suite, mục Cài đặt Trang.',
        secret: false,
      },
      {
        key: 'accessToken',
        label: 'Page Access Token',
        hint: 'Token của Trang, không phải token người dùng. Nên đổi sang loại dài hạn.',
        secret: true,
      },
    ],
    consoleUrl: 'https://developers.facebook.com/apps',
    steps: [
      'Vào developers.facebook.com, tạo ứng dụng loại Business.',
      'Thêm sản phẩm Facebook Login và cấp quyền pages_manage_posts cùng pages_read_engagement.',
      'Mở Graph API Explorer, chọn ứng dụng vừa tạo rồi chọn Trang của bạn.',
      'Bấm Generate Access Token, chấp nhận các quyền, rồi chép token ra.',
      'Đổi token ngắn hạn thành dài hạn bằng Access Token Debugger, nút Extend Access Token.',
      'Lấy Page ID trong Meta Business Suite, mục Cài đặt Trang.',
    ],
    requirements: [
      'Bạn phải là quản trị viên của Trang.',
      'Token người dùng không đăng được. Phải là token của chính Trang đó.',
    ],
    caveat:
      'Token dài hạn của Trang vẫn hết hạn khi mật khẩu tài khoản đổi hoặc khi bạn gỡ quyền ứng dụng. Đăng cho Trang của khách hàng ngoài tổ chức thì Meta bắt duyệt ứng dụng.',
  },
  {
    id: 'threads',
    label: 'Threads',
    proxyPrefix: '/api-proxy/threads',
    fields: [
      {
        key: 'accountId',
        label: 'Threads User ID',
        hint: 'Định danh tài khoản Threads, lấy từ endpoint /me của Threads API.',
        secret: false,
      },
      {
        key: 'accessToken',
        label: 'Threads Access Token',
        hint: 'Token riêng của Threads, khác token Facebook.',
        secret: true,
      },
    ],
    consoleUrl: 'https://developers.facebook.com/apps',
    steps: [
      'Vào developers.facebook.com, tạo ứng dụng rồi thêm sản phẩm Threads API.',
      'Trong phần Threads API, thêm quyền threads_basic và threads_content_publish.',
      'Mở Threads Graph API Explorer, chọn tài khoản Threads của bạn.',
      'Bấm Generate Access Token rồi chép token ra.',
      'Gọi /v1.0/me với token đó để lấy Threads User ID.',
    ],
    requirements: [
      'Tài khoản Threads phải được liên kết với một tài khoản Instagram chuyên nghiệp.',
      'Đăng chữ đi qua hai bước: tạo vùng chứa rồi mới xuất bản.',
    ],
    caveat: 'Threads giới hạn 250 bài mỗi 24 giờ cho mỗi tài khoản.',
  },
  {
    id: 'zalo-oa',
    label: 'Zalo OA',
    proxyPrefix: '/api-proxy/zalo',
    fields: [
      {
        key: 'accessToken',
        label: 'OA Access Token',
        hint: 'Token của Official Account, hết hạn sau 25 giờ và phải làm mới bằng refresh token.',
        secret: true,
      },
    ],
    consoleUrl: 'https://developers.zalo.me',
    steps: [
      'Vào developers.zalo.me, tạo ứng dụng rồi liên kết với Official Account của bạn.',
      'Trong phần Official Account API, bật quyền quản lý bài viết.',
      'Chạy luồng OAuth để lấy authorization code, sau đó đổi lấy access token và refresh token.',
      'Lưu refresh token ở nơi an toàn vì access token chỉ sống 25 giờ.',
    ],
    requirements: [
      'Official Account phải đã được xác thực. OA chưa xác thực không gọi được API đăng bài.',
      'Ứng dụng phải được liên kết đúng với OA đó.',
    ],
    caveat:
      'Access token hết hạn sau 25 giờ. Bản này chưa tự làm mới token — hết hạn thì phải dán token mới vào. Tự động làm mới cần nơi giữ refresh token an toàn, tức là phải có phía máy chủ.',
  },
];

export const getPublishChannel = (id: string): PublishChannel | undefined =>
  PUBLISH_CHANNELS.find((channel) => channel.id === id);
