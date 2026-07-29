/**
 * Các hostname chính thức có cùng-origin backend Egoric.
 *
 * `chatgpt.site` là đích Sites cũ; bản production hiện chạy trên Cloudflare
 * Worker (`workers.dev`). Giữ kiểm tra này tập trung để một lần đổi nơi deploy
 * không làm các module cloud tự nhận nhầm thành bản local.
 */
const HOSTED_SUFFIXES = ['.chatgpt.site', '.workers.dev'] as const;

export const isHostedHostname = (hostname?: string | null): boolean => {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return Boolean(normalized) && HOSTED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

export const isHostedRuntime = (): boolean =>
  typeof window !== 'undefined' && isHostedHostname(window.location.hostname);

/** Tên miền public do Egoric quản lý, không phải hostname mặc định của Sites. */
export const isEgoricPublicHostname = (hostname?: string | null): boolean => {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return isHostedHostname(normalized) && !normalized.endsWith('.chatgpt.site');
};
