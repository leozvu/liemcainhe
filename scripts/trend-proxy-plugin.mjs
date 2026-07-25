/**
 * Plugin Vite chuyển tiếp feed xu hướng khi chạy dev và preview.
 *
 * Không dùng được `server.proxy` tĩnh vì mười ba nguồn nằm trên nhiều tên miền
 * khác nhau, trong khi `server.proxy` chỉ ánh xạ một tiền tố tới một host.
 * Thay vào đó middleware này tra `id` trong allowlist rồi mới gọi ra ngoài,
 * nên trình duyệt không bao giờ gửi lên URL đích.
 *
 * Allowlist đọc trực tiếp từ services/content/trendSources.ts để không phải
 * duy trì hai bản danh sách.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_FILE = path.join(ROOT, '..', 'services', 'content', 'trendSources.ts');
const PREFIX = '/api-proxy/trends/';

/**
 * Bóc cặp id -> URL từ file TypeScript bằng cách đọc văn bản.
 *
 * Cố tình không import file .ts để plugin chạy được ở Node thuần, không cần
 * bước biên dịch trước. Đổi lại phải bám vào hình dạng của object literal, nên
 * hàm này sẽ ném lỗi to nếu không bóc được — hỏng lúc khởi động vẫn hơn là âm
 * thầm trả về allowlist rỗng.
 */
const readAllowlist = () => {
  const text = fs.readFileSync(SOURCES_FILE, 'utf8');
  const allowlist = new Map();

  const blocks = text.matchAll(/\{\s*id:\s*'([^']+)',[\s\S]*?host:\s*'([^']+)',\s*path:\s*'([^']+)',/g);
  for (const [, id, host, feedPath] of blocks) {
    allowlist.set(id, `${host}${feedPath}`);
  }

  if (allowlist.size === 0) {
    throw new Error(
      'Không bóc được nguồn xu hướng nào từ trendSources.ts. ' +
        'Có thể cấu trúc file đã đổi, hãy cập nhật readAllowlist trong scripts/trend-proxy-plugin.mjs.',
    );
  }

  return allowlist;
};

const handler = (allowlist) => async (req, res, next) => {
  if (!req.url || !req.url.startsWith(PREFIX)) return next();

  const id = decodeURIComponent(req.url.slice(PREFIX.length).split('?')[0]);
  const target = allowlist.get(id);

  if (!target) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Nguồn xu hướng không hợp lệ: ${id}` }));
    return;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EgoricFilmStudio/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(12000),
    });

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Không đọc được nguồn ${id}: ${error.message}` }));
  }
};

export const trendProxyPlugin = () => {
  const allowlist = readAllowlist();
  return {
    name: 'egoric-trend-proxy',
    configureServer(server) {
      server.middlewares.use(handler(allowlist));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(allowlist));
    },
  };
};
