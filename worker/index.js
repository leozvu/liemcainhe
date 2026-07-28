const API_TARGETS = {
  '/api-proxy/shopaikey': 'https://api.shopaikey.com',
  '/api-proxy/facebook': 'https://graph.facebook.com',
  '/api-proxy/threads': 'https://graph.threads.net',
  '/api-proxy/zalo': 'https://openapi.zalo.me',
};

// Bản sao runtime của PRODUCTION_JOB_KINDS trong types.ts. Worker được đóng
// gói độc lập nên test contract bắt buộc hai danh sách luôn giống nhau.
const PRODUCTION_JOB_KINDS = [
  'script-analysis',
  'creative-director',
  'video-factory',
  'ai-supervisor',
  'auto-editor',
  'agency-review',
  'asset-image',
  'keyframe-image',
  'video',
  'voice',
  'cloud-sync',
  'export',
];
const PRODUCTION_JOB_STAGES = ['script', 'assets', 'voice', 'director', 'export'];
const PRODUCTION_JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled'];

/**
 * Feed xu hướng Việt Nam cho Xưởng Nội dung.
 *
 * Tách khỏi API_TARGETS vì mười ba nguồn nằm trên nhiều tên miền, không khớp
 * mẫu "một tiền tố tới một host". Trình duyệt chỉ gửi lên `id`, worker tra
 * bảng này rồi mới gọi ra ngoài — proxy vẫn không nhận đích từ người dùng.
 *
 * Bảng này là bản sao của services/content/trendSources.ts vì worker chạy độc
 * lập, không import được TypeScript. tests/trendSources.test.ts khẳng định hai
 * bên luôn khớp nhau.
 */
const TREND_TARGETS = {
  'google-trends': 'https://trends.google.com/trending/rss?geo=VN',
  vnexpress: 'https://vnexpress.net/rss/tin-moi-nhat.rss',
  dantri: 'https://dantri.com.vn/rss/home.rss',
  tuoitre: 'https://tuoitre.vn/rss/tin-moi-nhat.rss',
  thanhnien: 'https://thanhnien.vn/rss/home.rss',
  kenh14: 'https://kenh14.vn/star.rss',
  soha: 'https://soha.vn/rss/home.rss',
  '24h': 'https://www.24h.com.vn/upload/rss/tintuctrongngay.rss',
  nld: 'https://nld.com.vn/rss/home.rss',
  vietnamplus: 'https://www.vietnamplus.vn/rss/tinmoinhat.rss',
  'tuoitre-giaitri': 'https://tuoitre.vn/rss/giai-tri.rss',
  cafef: 'https://cafef.vn/thi-truong-chung-khoan.rss',
  'vnexpress-congnghe': 'https://vnexpress.net/rss/khoa-hoc-cong-nghe.rss',
};

const TREND_PREFIX = '/api-proxy/trends/';

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const getAuthenticatedEmail = (request) => request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() || null;

const ALLOWED_PROXY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PROXY_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  'http-referer',
  'x-title',
  // Zalo OA truyền token qua header tuỳ biến này thay vì Authorization.
  'access_token',
]);

async function enforceProxyRateLimit(env, email, bucket, limit = 180) {
  if (!env.DB) return true;
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  const row = await env.DB.prepare(
    `INSERT INTO egoric_rate_limits (owner_email, bucket, window_start, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(owner_email, bucket) DO UPDATE SET
       window_start = CASE WHEN egoric_rate_limits.window_start = excluded.window_start THEN egoric_rate_limits.window_start ELSE excluded.window_start END,
       request_count = CASE WHEN egoric_rate_limits.window_start = excluded.window_start THEN egoric_rate_limits.request_count + 1 ELSE 1 END
     RETURNING request_count AS requestCount`
  ).bind(email, bucket, windowStart).first();
  return Number(row?.requestCount || 1) <= limit;
}

const getAuthenticatedName = (request) => {
  const value = request.headers.get('oai-authenticated-user-full-name');
  const encoding = request.headers.get('oai-authenticated-user-full-name-encoding');
  if (!value || encoding !== 'percent-encoded-utf-8') return null;
  try { return decodeURIComponent(value); } catch { return null; }
};

const hashOwner = async (email) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, '0')).join('');
};

const hashText = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
};

const safeProjectId = (value) => /^[a-zA-Z0-9_-]{3,120}$/.test(value || '') ? value : null;
const safeReviewId = (value) => /^[a-zA-Z0-9_-]{6,180}$/.test(value || '') ? value : null;
const safeFieldTestCode = (value) => /^[A-HJ-NP-Z2-9]{8}$/.test(value || '') ? value : null;
const safeFieldTestDeviceId = (value) => /^[a-zA-Z0-9_-]{8,160}$/.test(value || '') ? value : null;
const createFieldTestCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
};
// Danh sách trắng chứ không phải kiểm định dạng: tên bộ dữ liệu đi thẳng vào
// câu truy vấn, và số bộ là hữu hạn nên không có lý do gì để nhận tên tự do.
const WORKSPACE_COLLECTIONS = new Set([
  'agencyClients',
  'agencyCampaigns',
  'articleLibrary',
  'publishLedger',
  'managedAccounts',
  'campaignZeroRuns',
]);
const safeCollection = (value) => (WORKSPACE_COLLECTIONS.has(value) ? value : null);
const safeReviewToken = (value) => /^[a-zA-Z0-9_-]{40,180}$/.test(value || '') ? value : null;
const cleanText = (value, limit) => String(value || '').trim().slice(0, limit);
const createReviewToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const safeMediaPath = (value) => {
  const decoded = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!decoded || decoded.includes('..') || decoded.length > 500) return null;
  return decoded.split('/').map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_')).filter(Boolean).join('/');
};

const getCloudMediaPath = (projectId, value) => {
  if (typeof value !== 'string') return null;
  const prefix = `/api/cloud/media/${encodeURIComponent(projectId)}/`;
  let pathname = value;
  try { pathname = new URL(value, 'https://egoric.invalid').pathname; } catch { /* Giữ nguyên đường dẫn tương đối. */ }
  if (!pathname.startsWith(prefix)) return null;
  return safeMediaPath(pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
};

const getExternalMediaUrl = (value) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const safeImportMediaUrl = (value, base) => {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || privateIpv4) return null;
    return url;
  } catch {
    return null;
  }
};

const fetchExternalMedia = async (sourceUrl) => {
  let current = safeImportMediaUrl(sourceUrl);
  if (!current) throw new Error('URL media nguồn không an toàn.');
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual', headers: { accept: 'video/*,audio/*,image/*,*/*;q=0.5' } });
    if (response.status >= 300 && response.status < 400) {
      current = safeImportMediaUrl(response.headers.get('location'), current);
      if (!current) throw new Error('Media nguồn chuyển hướng tới địa chỉ không an toàn.');
      continue;
    }
    return response;
  }
  throw new Error('Media nguồn chuyển hướng quá nhiều lần.');
};

async function deleteMediaPrefix(bucket, prefix) {
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

const safeChecksum = (value) => /^[a-f0-9]{64}$/i.test(value || '') ? value.toLowerCase() : null;
const safeUploadId = (value) => typeof value === 'string' && value.length >= 6 && value.length <= 1000 ? value : null;

async function saveMediaMetadata(env, input) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO egoric_media (owner_email, project_id, path, content_type, bytes, checksum, etag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, project_id, path) DO UPDATE SET
       content_type = excluded.content_type, bytes = excluded.bytes, checksum = excluded.checksum,
       etag = excluded.etag, updated_at = excluded.updated_at`
  ).bind(
    input.email, input.projectId, input.mediaPath, input.contentType || 'application/octet-stream',
    Math.max(0, Number(input.bytes) || 0), input.checksum || null, input.etag || null, now, now,
  ).run();
}

async function handleCloudApi(request, env, url) {
  if (!env.DB || !env.MEDIA) return json({ error: 'Cloud workspace chưa được cấp D1/R2.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để đồng bộ dự án.' }, 401);

  const projectMatch = url.pathname.match(/^\/api\/cloud\/projects\/([^/]+)$/);
  if (url.pathname === '/api/cloud/projects' && request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT project_id AS id, title, updated_at AS updatedAt FROM egoric_projects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100'
    ).bind(email).all();
    return json({ projects: result.results || [] });
  }

  if (projectMatch) {
    const projectId = safeProjectId(decodeURIComponent(projectMatch[1]));
    if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);

    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT payload_json AS payload FROM egoric_projects WHERE owner_email = ? AND project_id = ?'
      ).bind(email, projectId).first();
      return row ? json({ project: JSON.parse(row.payload) }) : json({ error: 'Không tìm thấy dự án cloud.' }, 404);
    }

    if (request.method === 'PUT') {
      const project = await request.json();
      if (!project || project.id !== projectId || typeof project.title !== 'string') return json({ error: 'Dữ liệu dự án không hợp lệ.' }, 400);
      const payload = JSON.stringify(project);
      if (payload.length > 8_000_000) return json({ error: 'Dữ liệu dự án quá lớn; hãy đồng bộ media trước.' }, 413);
      const updatedAt = Date.now();
      await env.DB.prepare(
        `INSERT INTO egoric_projects (owner_email, project_id, title, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_email, project_id) DO UPDATE SET title = excluded.title, payload_json = excluded.payload_json, updated_at = excluded.updated_at`
      ).bind(email, projectId, project.title.slice(0, 240), payload, updatedAt).run();
      return json({ id: projectId, updatedAt });
    }

    if (request.method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM egoric_client_review_comments WHERE portal_id IN (SELECT id FROM egoric_client_review_portals WHERE owner_email = ? AND project_id = ?)').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_client_review_portals WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_projects WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_jobs WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_media WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_review_notes WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
        env.DB.prepare('DELETE FROM egoric_stage_approvals WHERE owner_email = ? AND project_id = ?').bind(email, projectId),
      ]);
      const owner = await hashOwner(email);
      await deleteMediaPrefix(env.MEDIA, `${owner}/${projectId}/`);
      return json({ deleted: true });
    }
  }

  /**
   * Dữ liệu cấp workspace: khách hàng, chiến dịch, Campaign 0, thư viện bài,
   * sổ cái đăng bài và sổ tài khoản. Các bộ này trước đây chỉ nằm trong
   * IndexedDB của đúng một trình duyệt.
   *
   * `deleted_at` là bia mộ: xoá mà không để lại dấu thì máy khác sẽ đẩy bản ghi
   * cũ lên lại và thứ vừa xoá sống dậy.
   */
  if (url.pathname === '/api/cloud/workspace/field-tests' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const deviceId = safeFieldTestDeviceId(body?.deviceId);
    const deviceLabel = cleanText(body?.deviceLabel, 80);
    if (!deviceId || !deviceLabel) return json({ error: 'Danh tính thiết bị A không hợp lệ.' }, 400);

    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createFieldTestCode();
      const existing = await env.DB.prepare(
        'SELECT item_id AS id FROM egoric_workspace_items WHERE owner_email = ? AND collection = ? AND item_id = ?'
      ).bind(email, 'syncFieldTests', code).first();
      if (existing) continue;
      const session = {
        version: 1, id: code, code, status: 'waiting',
        deviceA: { id: deviceId, label: deviceLabel },
        createdAt: now, updatedAt: now, expiresAt: now + 24 * 60 * 60 * 1000,
      };
      await env.DB.prepare(
        `INSERT INTO egoric_workspace_items (owner_email, collection, item_id, payload_json, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      ).bind(email, 'syncFieldTests', code, JSON.stringify(session), now).run();
      return json({ session }, 201);
    }
    return json({ error: 'Không tạo được mã duy nhất. Hãy thử lại.' }, 503);
  }

  if (url.pathname === '/api/cloud/workspace/field-tests/latest' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT payload_json AS payload FROM egoric_workspace_items
       WHERE owner_email = ? AND collection = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 20`
    ).bind(email, 'syncFieldTests').all();
    const now = Date.now();
    const session = (result.results || [])
      .map((row) => { try { return JSON.parse(row.payload); } catch { return null; } })
      .find((item) => item?.status === 'verified' && Number(item.expiresAt) > now);
    return json({ session: session || null });
  }

  const fieldTestMatch = url.pathname.match(/^\/api\/cloud\/workspace\/field-tests\/([^/]+?)(?:\/(ack|verify))?$/);
  if (fieldTestMatch) {
    const code = safeFieldTestCode(decodeURIComponent(fieldTestMatch[1]).toUpperCase());
    if (!code) return json({ error: 'Mã kiểm tra không hợp lệ.' }, 400);
    const action = fieldTestMatch[2];
    const row = await env.DB.prepare(
      `SELECT payload_json AS payload FROM egoric_workspace_items
       WHERE owner_email = ? AND collection = ? AND item_id = ? AND deleted_at IS NULL`
    ).bind(email, 'syncFieldTests', code).first();
    if (!row) return json({ error: 'Không tìm thấy mã kiểm tra trong workspace này.' }, 404);
    let session;
    try { session = JSON.parse(row.payload); } catch { return json({ error: 'Bằng chứng cloud bị hỏng.' }, 500); }

    const now = Date.now();
    if (Number(session.expiresAt) <= now) return json({ error: 'Mã kiểm tra đã hết hạn. Hãy tạo mã mới.' }, 410);
    if (!action && request.method === 'GET') return json({ session });

    const body = await request.json().catch(() => null);
    const deviceId = safeFieldTestDeviceId(body?.deviceId);
    if (!deviceId) return json({ error: 'Danh tính thiết bị không hợp lệ.' }, 400);

    if (action === 'ack' && request.method === 'PUT') {
      const deviceLabel = cleanText(body?.deviceLabel, 80);
      if (!deviceLabel) return json({ error: 'Hãy đặt tên cho thiết bị B.' }, 400);
      if (deviceId === session.deviceA?.id) return json({ error: 'Phải xác nhận bằng một thiết bị khác thiết bị A.' }, 409);
      if (session.status === 'verified') return json({ session });
      if (session.deviceB?.id && session.deviceB.id !== deviceId) {
        return json({ error: 'Mã này đã được một thiết bị B khác xác nhận.' }, 409);
      }
      session = {
        ...session, status: 'acknowledged', deviceB: { id: deviceId, label: deviceLabel },
        acknowledgedAt: session.acknowledgedAt || now, updatedAt: now,
      };
    } else if (action === 'verify' && request.method === 'PUT') {
      if (deviceId !== session.deviceA?.id) return json({ error: 'Chỉ thiết bị A đã tạo mã mới được chốt bằng chứng.' }, 403);
      if (session.status === 'verified') return json({ session });
      if (session.status !== 'acknowledged' || !session.deviceB?.id) {
        return json({ error: 'Thiết bị B chưa xác nhận mã này.' }, 409);
      }
      session = {
        ...session, status: 'verified', verifiedAt: now, updatedAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      };
    } else {
      return json({ error: 'Phương thức không được hỗ trợ.' }, 405);
    }

    await env.DB.prepare(
      `UPDATE egoric_workspace_items SET payload_json = ?, updated_at = ?
       WHERE owner_email = ? AND collection = ? AND item_id = ?`
    ).bind(JSON.stringify(session), now, email, 'syncFieldTests', code).run();
    return json({ session });
  }

  if (url.pathname === '/api/cloud/workspace/health' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT collection,
              SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS tombstones,
              MAX(updated_at) AS newestAt
       FROM egoric_workspace_items
       WHERE owner_email = ?
       GROUP BY collection`
    ).bind(email).all();

    const byCollection = new Map((result.results || []).map((row) => [row.collection, row]));
    const collections = Array.from(WORKSPACE_COLLECTIONS).map((collection) => {
      const row = byCollection.get(collection);
      return {
        collection,
        active: Number(row?.active) || 0,
        tombstones: Number(row?.tombstones) || 0,
        newestAt: Number(row?.newestAt) || undefined,
      };
    });

    return json({ ok: true, serverTime: Date.now(), collections });
  }

  if (url.pathname === '/api/cloud/workspace' && request.method === 'GET') {
    const collection = safeCollection(url.searchParams.get('collection'));
    if (!collection) return json({ error: 'Bộ dữ liệu không hợp lệ.' }, 400);

    const since = Number(url.searchParams.get('since')) || 0;
    const result = await env.DB.prepare(
      `SELECT item_id AS id, payload_json AS payload, updated_at AS updatedAt, deleted_at AS deletedAt
       FROM egoric_workspace_items
       WHERE owner_email = ? AND collection = ? AND updated_at > ?
       ORDER BY updated_at ASC LIMIT 2000`
    ).bind(email, collection, since).all();

    const records = (result.results || []).map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt || undefined,
      payload: row.payload ? JSON.parse(row.payload) : null,
    }));
    return json({ records });
  }

  if (url.pathname === '/api/cloud/workspace' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    const collection = safeCollection(body?.collection);
    if (!collection || !Array.isArray(body?.records)) {
      return json({ error: 'Dữ liệu đồng bộ không hợp lệ.' }, 400);
    }
    if (body.records.length > 500) return json({ error: 'Mỗi lượt tối đa 500 bản ghi.' }, 413);

    const statements = [];
    for (const record of body.records) {
      if (!record || typeof record.id !== 'string' || !record.id) continue;
      const payload = JSON.stringify(record.payload ?? null);
      if (payload.length > 1_000_000) return json({ error: `Bản ghi ${record.id} quá lớn.` }, 413);
      const updatedAt = Number(record.updatedAt) || Date.now();
      const deletedAt = Number(record.deletedAt) || null;

      statements.push(
        env.DB.prepare(
          `INSERT INTO egoric_workspace_items (owner_email, collection, item_id, payload_json, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_email, collection, item_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > egoric_workspace_items.updated_at
              OR (excluded.updated_at = egoric_workspace_items.updated_at
                  AND excluded.payload_json >= egoric_workspace_items.payload_json)`
        ).bind(email, collection, record.id.slice(0, 200), payload, updatedAt, deletedAt)
      );
    }

    if (statements.length) await env.DB.batch(statements);
    return json({ written: statements.length });
  }

  if (url.pathname === '/api/cloud/media/import' && request.method === 'POST') {
    const payload = await request.json();
    const projectId = safeProjectId(payload?.projectId);
    const mediaPath = safeMediaPath(payload?.path);
    const sourceUrl = safeImportMediaUrl(payload?.sourceUrl);
    if (!projectId || !mediaPath || !sourceUrl) return json({ error: 'Thông tin media nguồn không hợp lệ.' }, 400);
    const source = await fetchExternalMedia(sourceUrl);
    if (!source.ok || !source.body) return json({ error: `Không thể tải media từ nhà cung cấp (${source.status}).` }, 502);
    const declaredBytes = Math.max(0, Number(source.headers.get('content-length')) || 0);
    if (declaredBytes > 1_500_000_000) return json({ error: 'Media nguồn vượt giới hạn 1,5 GB.' }, 413);
    const contentType = source.headers.get('content-type') || 'application/octet-stream';
    const owner = await hashOwner(email);
    const object = await env.MEDIA.put(`${owner}/${projectId}/${mediaPath}`, source.body, { httpMetadata: { contentType } });
    await saveMediaMetadata(env, {
      email, projectId, mediaPath, contentType, etag: object?.httpEtag, bytes: declaredBytes,
    });
    const encodedPath = mediaPath.split('/').map(encodeURIComponent).join('/');
    return json({ url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` }, 201);
  }

  if (url.pathname === '/api/cloud/media/uploads' && request.method === 'POST') {
    const payload = await request.json();
    const projectId = safeProjectId(payload?.projectId);
    const mediaPath = safeMediaPath(payload?.path);
    const checksum = safeChecksum(payload?.checksum);
    const contentType = String(payload?.contentType || 'application/octet-stream').slice(0, 160);
    const bytes = Math.max(0, Math.min(5 * 1024 * 1024 * 1024, Number(payload?.size) || 0));
    if (!projectId || !mediaPath || !checksum || !bytes) return json({ error: 'Thông tin phiên upload không hợp lệ.' }, 400);
    const owner = await hashOwner(email);
    const key = `${owner}/${projectId}/${mediaPath}`;
    const existing = await env.DB.prepare(
      'SELECT checksum FROM egoric_media WHERE owner_email = ? AND project_id = ? AND path = ?'
    ).bind(email, projectId, mediaPath).first();
    if (existing?.checksum === checksum && await env.MEDIA.head(key)) {
      const encodedPath = mediaPath.split('/').map(encodeURIComponent).join('/');
      return json({ skipped: true, url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` });
    }
    const encodedPath = mediaPath.split('/').map(encodeURIComponent).join('/');
    if (!payload?.multipart) {
      return json({ skipped: false, url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` });
    }
    const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType } });
    return json({ skipped: false, uploadId: upload.uploadId, url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` }, 201);
  }

  const uploadPartMatch = url.pathname.match(/^\/api\/cloud\/media\/uploads\/([^/]+)\/parts\/(\d+)$/);
  if (uploadPartMatch && request.method === 'PUT') {
    const uploadId = safeUploadId(decodeURIComponent(uploadPartMatch[1]));
    const partNumber = Number(uploadPartMatch[2]);
    const projectId = safeProjectId(url.searchParams.get('projectId'));
    const mediaPath = safeMediaPath(url.searchParams.get('path'));
    if (!uploadId || !projectId || !mediaPath || partNumber < 1 || partNumber > 10000 || !request.body) {
      return json({ error: 'Phần upload không hợp lệ.' }, 400);
    }
    const owner = await hashOwner(email);
    const upload = env.MEDIA.resumeMultipartUpload(`${owner}/${projectId}/${mediaPath}`, uploadId);
    const uploaded = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  }

  const uploadCompleteMatch = url.pathname.match(/^\/api\/cloud\/media\/uploads\/([^/]+)\/complete$/);
  if (uploadCompleteMatch && request.method === 'POST') {
    const uploadId = safeUploadId(decodeURIComponent(uploadCompleteMatch[1]));
    const payload = await request.json();
    const projectId = safeProjectId(payload?.projectId);
    const mediaPath = safeMediaPath(payload?.path);
    const checksum = safeChecksum(payload?.checksum);
    const parts = Array.isArray(payload?.parts) ? payload.parts.slice(0, 10000) : [];
    if (!uploadId || !projectId || !mediaPath || !checksum || !parts.length) return json({ error: 'Không thể hoàn tất phiên upload.' }, 400);
    const owner = await hashOwner(email);
    const upload = env.MEDIA.resumeMultipartUpload(`${owner}/${projectId}/${mediaPath}`, uploadId);
    const object = await upload.complete(parts.map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag || '') })));
    await saveMediaMetadata(env, {
      email, projectId, mediaPath, checksum, etag: object.httpEtag,
      bytes: Math.max(0, Number(payload?.size) || 0), contentType: String(payload?.contentType || 'application/octet-stream').slice(0, 160),
    });
    const encodedPath = mediaPath.split('/').map(encodeURIComponent).join('/');
    return json({ url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` });
  }

  if (uploadCompleteMatch && request.method === 'DELETE') {
    const uploadId = safeUploadId(decodeURIComponent(uploadCompleteMatch[1]));
    const projectId = safeProjectId(url.searchParams.get('projectId'));
    const mediaPath = safeMediaPath(url.searchParams.get('path'));
    if (!uploadId || !projectId || !mediaPath) return json({ error: 'Phiên upload không hợp lệ.' }, 400);
    const owner = await hashOwner(email);
    await env.MEDIA.resumeMultipartUpload(`${owner}/${projectId}/${mediaPath}`, uploadId).abort();
    return json({ aborted: true });
  }

  if (url.pathname === '/api/cloud/media/cleanup' && request.method === 'POST') {
    const payload = await request.json();
    const projectId = safeProjectId(payload?.projectId);
    if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);
    const usedPaths = new Set((Array.isArray(payload?.usedPaths) ? payload.usedPaths : []).slice(0, 5000).map(safeMediaPath).filter(Boolean));
    const owner = await hashOwner(email);
    const prefix = `${owner}/${projectId}/`;
    const orphanKeys = [];
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor });
      page.objects.forEach((object) => {
        const relativePath = object.key.slice(prefix.length);
        if (!usedPaths.has(relativePath)) orphanKeys.push(object.key);
      });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    for (let index = 0; index < orphanKeys.length; index += 1000) await env.MEDIA.delete(orphanKeys.slice(index, index + 1000));
    const metadata = await env.DB.prepare(
      'SELECT path FROM egoric_media WHERE owner_email = ? AND project_id = ? LIMIT 5000'
    ).bind(email, projectId).all();
    const orphanMetadata = (metadata.results || []).filter((row) => !usedPaths.has(row.path));
    for (let index = 0; index < orphanMetadata.length; index += 100) {
      await env.DB.batch(orphanMetadata.slice(index, index + 100).map((row) =>
        env.DB.prepare('DELETE FROM egoric_media WHERE owner_email = ? AND project_id = ? AND path = ?').bind(email, projectId, row.path)
      ));
    }
    return json({ deleted: orphanKeys.length });
  }

  if (url.pathname === '/api/cloud/media' && request.method === 'PUT') {
    const projectId = safeProjectId(url.searchParams.get('projectId'));
    const mediaPath = safeMediaPath(url.searchParams.get('path'));
    if (!projectId || !mediaPath) return json({ error: 'Đường dẫn media không hợp lệ.' }, 400);
    if (!request.body) return json({ error: 'Không có dữ liệu media.' }, 400);
    const owner = await hashOwner(email);
    const key = `${owner}/${projectId}/${mediaPath}`;
    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    const object = await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType },
    });
    await saveMediaMetadata(env, {
      email, projectId, mediaPath, contentType, checksum: safeChecksum(request.headers.get('x-egoric-checksum')),
      etag: object?.httpEtag, bytes: Number(request.headers.get('x-egoric-size') || request.headers.get('content-length') || 0),
    });
    const encodedPath = mediaPath.split('/').map(encodeURIComponent).join('/');
    return json({ url: `/api/cloud/media/${encodeURIComponent(projectId)}/${encodedPath}` });
  }

  const mediaMatch = url.pathname.match(/^\/api\/cloud\/media\/([^/]+)\/(.+)$/);
  if (mediaMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    const projectId = safeProjectId(decodeURIComponent(mediaMatch[1]));
    const mediaPath = safeMediaPath(mediaMatch[2].split('/').map(decodeURIComponent).join('/'));
    if (!projectId || !mediaPath) return new Response('Not found', { status: 404 });
    const owner = await hashOwner(email);
    const object = await env.MEDIA.get(`${owner}/${projectId}/${mediaPath}`);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'private, max-age=3600');
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  }

  return json({ error: 'Cloud route không tồn tại.' }, 404);
}

async function ensureAccountProfile(request, env, email) {
  const now = Date.now();
  const defaultName = getAuthenticatedName(request) || email.split('@')[0] || 'Nhà sản xuất Egoric';
  await env.DB.prepare(
    `INSERT INTO egoric_profiles (owner_email, display_name, studio_name, plan, monthly_unit_limit, created_at, updated_at)
     VALUES (?, ?, 'Egoric Agency', 'Bản thử Studio', 1000, ?, ?)
     ON CONFLICT(owner_email) DO NOTHING`
  ).bind(email, defaultName.slice(0, 120), now, now).run();
  return env.DB.prepare(
    `SELECT owner_email AS email, display_name AS displayName, studio_name AS studioName,
            plan, monthly_unit_limit AS monthlyUnitLimit, created_at AS createdAt, updated_at AS updatedAt
     FROM egoric_profiles WHERE owner_email = ?`
  ).bind(email).first();
}

async function handleAccountApi(request, env, url) {
  if (!env.DB) return json({ error: 'Workspace chưa được cấp cơ sở dữ liệu.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để mở workspace.' }, 401);

  if (url.pathname === '/api/account' && request.method === 'GET') {
    const profile = await ensureAccountProfile(request, env, email);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const summary = await env.DB.prepare(
      `SELECT COALESCE(SUM(units), 0) AS monthlyUnits,
              COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd
       FROM egoric_usage_events WHERE owner_email = ? AND created_at >= ?`
    ).bind(email, monthStart.getTime()).first();
    const events = await env.DB.prepare(
      `SELECT id, project_id AS projectId, kind, provider_id AS providerId, model_id AS modelId, resource_id AS resourceId,
              units, estimated_cost_usd AS estimatedCostUsd, duration_ms AS durationMs,
              status, error, created_at AS timestamp
       FROM egoric_usage_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(email).all();
    const systemEvents = await env.DB.prepare(
      `SELECT id, project_id AS projectId, severity, source, message, created_at AS createdAt
       FROM egoric_system_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(email).all();
    return json({ profile, monthlyUnits: summary?.monthlyUnits || 0, estimatedCostUsd: summary?.estimatedCostUsd || 0, recentEvents: events.results || [], systemEvents: systemEvents.results || [] });
  }

  if (url.pathname === '/api/account' && request.method === 'PUT') {
    const payload = await request.json();
    const displayName = String(payload?.displayName || '').trim().slice(0, 120);
    const studioName = String(payload?.studioName || '').trim().slice(0, 160);
    const monthlyUnitLimit = Math.max(10, Math.min(1_000_000, Number(payload?.monthlyUnitLimit) || 1000));
    if (!displayName || !studioName) return json({ error: 'Tên hiển thị và tên studio không được để trống.' }, 400);
    await ensureAccountProfile(request, env, email);
    await env.DB.prepare(
      `UPDATE egoric_profiles SET display_name = ?, studio_name = ?, monthly_unit_limit = ?, updated_at = ? WHERE owner_email = ?`
    ).bind(displayName, studioName, monthlyUnitLimit, Date.now(), email).run();
    return json({ profile: await ensureAccountProfile(request, env, email) });
  }

  if (url.pathname === '/api/account/usage' && request.method === 'POST') {
    const payload = await request.json();
    const id = /^[a-zA-Z0-9_-]{6,160}$/.test(payload?.id || '') ? payload.id : `usage_${crypto.randomUUID()}`;
    const kind = ['chat', 'image', 'video', 'voice', 'cloud', 'export'].includes(payload?.kind) ? payload.kind : null;
    const status = ['success', 'failed'].includes(payload?.status) ? payload.status : null;
    if (!kind || !status) return json({ error: 'Sự kiện sử dụng không hợp lệ.' }, 400);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO egoric_usage_events
       (id, owner_email, project_id, kind, provider_id, model_id, resource_id, units, estimated_cost_usd, duration_ms, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, email, safeProjectId(payload.projectId), kind,
      String(payload.providerId || '').slice(0, 120) || null,
      String(payload.modelId || '').slice(0, 200) || null,
      cleanText(payload.resourceId, 240) || null,
      Math.max(0, Number(payload.units) || 0), Math.max(0, Number(payload.estimatedCostUsd) || 0),
      Math.max(0, Number(payload.durationMs) || 0) || null, status,
      String(payload.error || '').slice(0, 800) || null,
      Math.min(Date.now(), Math.max(0, Number(payload.timestamp) || Date.now())),
    ).run();
    return json({ saved: true }, 201);
  }

  if (url.pathname === '/api/account/events' && request.method === 'POST') {
    const payload = await request.json();
    const severity = ['info', 'warning', 'error'].includes(payload?.severity) ? payload.severity : 'info';
    const message = String(payload?.message || '').trim().slice(0, 1000);
    if (!message) return json({ error: 'Nội dung sự kiện không hợp lệ.' }, 400);
    await env.DB.prepare(
      `INSERT INTO egoric_system_events (id, owner_email, project_id, severity, source, message, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `event_${crypto.randomUUID()}`, email, safeProjectId(payload.projectId), severity,
      String(payload.source || 'app').slice(0, 100), message,
      payload.detail ? JSON.stringify(payload.detail).slice(0, 4000) : null, Date.now(),
    ).run();
    return json({ saved: true }, 201);
  }

  if (url.pathname === '/api/account/events' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, project_id AS projectId, severity, source, message, detail_json AS detailJson, created_at AS createdAt
       FROM egoric_system_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(email).all();
    return json({ events: result.results || [] });
  }

  if (url.pathname === '/api/account/export' && request.method === 'GET') {
    const [profile, projects, usage, events, jobs, media, notes, approvals, clientReviewPortals, clientReviewComments, campaignFinancials, distributionPackages, distributionConnections, distributionJobs] = await Promise.all([
      ensureAccountProfile(request, env, email),
      env.DB.prepare('SELECT project_id AS projectId, title, payload_json AS payloadJson, updated_at AS updatedAt FROM egoric_projects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_usage_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_system_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT project_id, path, content_type, bytes, checksum, etag, created_at, updated_at FROM egoric_media WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 10000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_review_notes WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_stage_approvals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT id, project_id, title, client_name, campaign_name, deliverable_title, status, decision, decision_version_id, decision_artifact_signature, decision_note, reviewer_name, reviewer_email, decided_at, expires_at, payload_json, created_at, updated_at FROM egoric_client_review_portals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_client_review_comments WHERE portal_id IN (SELECT id FROM egoric_client_review_portals WHERE owner_email = ?) ORDER BY updated_at DESC LIMIT 10000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_campaign_financials WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_distribution_packages WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT id, platform, external_account_id, display_name, status, scopes_json, expires_at, last_verified_at, created_at, updated_at FROM egoric_distribution_connections WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT id, project_id, package_id, platform, connection_id, status, idempotency_key, attempt, payload_json, created_at, updated_at FROM egoric_distribution_jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
    ]);
    return json({
      product: 'Egoric Film Studio', exportedAt: new Date().toISOString(), profile,
      projects: (projects.results || []).map((project) => ({ ...project, payload: JSON.parse(project.payloadJson), payloadJson: undefined })),
      usage: usage.results || [], events: events.results || [], jobs: jobs.results || [],
      media: media.results || [], reviewNotes: notes.results || [], approvals: approvals.results || [],
      clientReviewPortals: clientReviewPortals.results || [], clientReviewComments: clientReviewComments.results || [],
      campaignFinancials: campaignFinancials.results || [],
      distributionPackages: distributionPackages.results || [],
      distributionConnections: distributionConnections.results || [],
      distributionJobs: distributionJobs.results || [],
    });
  }

  if (url.pathname === '/api/account/data' && request.method === 'DELETE') {
    if (request.headers.get('x-egoric-confirm') !== 'DELETE_ACCOUNT_DATA') {
      return json({ error: 'Thiếu xác nhận xóa dữ liệu.' }, 400);
    }
    const owner = await hashOwner(email);
    await deleteMediaPrefix(env.MEDIA, `${owner}/`);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM egoric_client_review_comments WHERE portal_id IN (SELECT id FROM egoric_client_review_portals WHERE owner_email = ?)').bind(email),
      env.DB.prepare('DELETE FROM egoric_distribution_jobs WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_distribution_oauth_states WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_distribution_connections WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_distribution_packages WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_client_review_portals WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_stage_approvals WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_review_notes WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_media WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_jobs WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_projects WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_workspace_items WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_usage_events WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_campaign_financials WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_system_events WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_profiles WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_rate_limits WHERE owner_email = ?').bind(email),
    ]);
    return json({ deleted: true });
  }

  return json({ error: 'Account route không tồn tại.' }, 404);
}

const mapCampaignFinancial = (row) => ({
  campaignId: row.campaignId ?? row.campaign_id,
  campaignName: row.campaignName ?? row.campaign_name,
  clientName: row.clientName ?? row.client_name ?? undefined,
  quotedRevenueVnd: Number(row.quotedRevenueVnd ?? row.quoted_revenue_vnd ?? 0),
  laborHours: Number(row.laborHours ?? row.labor_hours ?? 0),
  laborHourlyRateVnd: Number(row.laborHourlyRateVnd ?? row.labor_hourly_rate_vnd ?? 0),
  otherCostVnd: Number(row.otherCostVnd ?? row.other_cost_vnd ?? 0),
  exchangeRateVndPerUsd: Number(row.exchangeRateVndPerUsd ?? row.exchange_rate_vnd_per_usd ?? 26000),
  notes: row.notes || undefined,
  createdAt: Number(row.createdAt ?? row.created_at),
  updatedAt: Number(row.updatedAt ?? row.updated_at),
});

async function handleAgencyEconomicsApi(request, env) {
  if (!env.DB) return json({ error: 'Dashboard tài chính chưa được cấp cơ sở dữ liệu.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để xem tài chính agency.' }, 401);

  if (request.method === 'GET') {
    const [usage, financials, projects, portals] = await Promise.all([
      env.DB.prepare(
        `SELECT id, project_id AS projectId, kind, provider_id AS providerId, model_id AS modelId,
                resource_id AS resourceId, units, estimated_cost_usd AS estimatedCostUsd,
                duration_ms AS durationMs, status, error, created_at AS timestamp
         FROM egoric_usage_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000`
      ).bind(email).all(),
      env.DB.prepare(
        `SELECT campaign_id AS campaignId, campaign_name AS campaignName, client_name AS clientName,
                quoted_revenue_vnd AS quotedRevenueVnd, labor_hours AS laborHours,
                labor_hourly_rate_vnd AS laborHourlyRateVnd, other_cost_vnd AS otherCostVnd,
                exchange_rate_vnd_per_usd AS exchangeRateVndPerUsd, notes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM egoric_campaign_financials WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000`
      ).bind(email).all(),
      env.DB.prepare(
        'SELECT project_id AS projectId, title, payload_json AS payloadJson, updated_at AS updatedAt FROM egoric_projects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 500'
      ).bind(email).all(),
      env.DB.prepare(
        `SELECT project_id AS projectId, decision, decision_version_id AS decisionVersionId, payload_json AS payloadJson
         FROM egoric_client_review_portals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000`
      ).bind(email).all(),
    ]);

    const acceptedByProject = new Map();
    (portals.results || []).forEach((row) => {
      if (row.decision !== 'approved' || acceptedByProject.has(row.projectId)) return;
      try {
        const payload = JSON.parse(row.payloadJson || '{}');
        const versions = Array.isArray(payload.versions) ? payload.versions : [];
        const version = versions.find((item) => item.id === row.decisionVersionId) || versions.at(-1);
        acceptedByProject.set(row.projectId, new Set((version?.clips || []).map((clip) => clip.shotId).filter(Boolean)));
      } catch { /* Giữ dự án ở trạng thái chưa nghiệm thu nếu payload lỗi. */ }
    });

    const projectRefs = (projects.results || []).flatMap((row) => {
      try {
        const payload = JSON.parse(row.payloadJson || '{}');
        const accepted = acceptedByProject.get(row.projectId);
        const approvedRoundShots = (payload.agencyReview?.rounds || [])
          .filter((round) => round.status === 'approved')
          .flatMap((round) => round.shotIds || []);
        const acceptedShotIds = Array.from(new Set([...(accepted || []), ...approvedRoundShots]));
        return [{
          projectId: row.projectId,
          title: row.title,
          campaignId: safeProjectId(payload.campaignId) || undefined,
          clientId: safeProjectId(payload.clientId) || undefined,
          deliverableId: safeProjectId(payload.deliverableId) || undefined,
          approved: acceptedShotIds.length > 0,
          acceptedShotIds,
          shots: (Array.isArray(payload.shots) ? payload.shots : []).map((shot, index) => ({
            id: cleanText(shot.id, 160),
            label: `Cảnh ${String(index + 1).padStart(2, '0')}`,
            actionSummary: cleanText(shot.actionSummary, 180),
          })).filter((shot) => shot.id),
          updatedAt: Number(row.updatedAt),
        }];
      } catch { return []; }
    });

    return json({
      usage: usage.results || [],
      financials: (financials.results || []).map(mapCampaignFinancial),
      projects: projectRefs,
    });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const campaignId = safeProjectId(body?.campaignId);
    const campaignName = cleanText(body?.campaignName, 240);
    if (!campaignId || !campaignName) return json({ error: 'Chiến dịch tài chính không hợp lệ.' }, 400);
    const amount = (value, max = 1_000_000_000_000) => Math.max(0, Math.min(max, Number(value) || 0));
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO egoric_campaign_financials
        (owner_email, campaign_id, campaign_name, client_name, quoted_revenue_vnd, labor_hours,
         labor_hourly_rate_vnd, other_cost_vnd, exchange_rate_vnd_per_usd, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, campaign_id) DO UPDATE SET
         campaign_name = excluded.campaign_name, client_name = excluded.client_name,
         quoted_revenue_vnd = excluded.quoted_revenue_vnd, labor_hours = excluded.labor_hours,
         labor_hourly_rate_vnd = excluded.labor_hourly_rate_vnd, other_cost_vnd = excluded.other_cost_vnd,
         exchange_rate_vnd_per_usd = excluded.exchange_rate_vnd_per_usd, notes = excluded.notes,
         updated_at = excluded.updated_at`
    ).bind(
      email, campaignId, campaignName, cleanText(body?.clientName, 200) || null,
      amount(body?.quotedRevenueVnd), amount(body?.laborHours, 100_000), amount(body?.laborHourlyRateVnd),
      amount(body?.otherCostVnd), Math.max(1, Math.min(1_000_000, Number(body?.exchangeRateVndPerUsd) || 26000)),
      cleanText(body?.notes, 2000) || null, now, now,
    ).run();
    const saved = await env.DB.prepare('SELECT * FROM egoric_campaign_financials WHERE owner_email = ? AND campaign_id = ?').bind(email, campaignId).first();
    return json({ financial: mapCampaignFinancial(saved) });
  }

  return json({ error: 'Economics route không tồn tại.' }, 405);
}

const JOB_SELECT_COLUMNS = `id, kind, stage, label, status, progress,
  completed_units AS completedUnits, total_units AS totalUnits, resource_id AS resourceId,
  idempotency_key AS idempotencyKey, provider_task_id AS providerTaskId,
  detail, error, attempts, created_at AS createdAt, updated_at AS updatedAt`;

const isValidProductionJob = (job) =>
  /^[a-zA-Z0-9_-]{6,160}$/.test(job?.id || '')
  && PRODUCTION_JOB_KINDS.includes(job?.kind)
  && PRODUCTION_JOB_STAGES.includes(job?.stage)
  && PRODUCTION_JOB_STATUSES.includes(job?.status);

const prepareProductionJobWrite = (env, email, projectId, job, claimOnly = false) => env.DB.prepare(
  `INSERT INTO egoric_jobs
   (id, owner_email, project_id, kind, stage, label, status, progress, completed_units, total_units,
    resource_id, idempotency_key, provider_task_id, detail, error, attempts, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ${claimOnly ? 'ON CONFLICT DO NOTHING' : `ON CONFLICT DO UPDATE SET
     label = excluded.label, status = excluded.status, progress = excluded.progress,
     completed_units = excluded.completed_units, total_units = excluded.total_units,
     resource_id = excluded.resource_id,
     idempotency_key = COALESCE(excluded.idempotency_key, egoric_jobs.idempotency_key),
     provider_task_id = COALESCE(excluded.provider_task_id, egoric_jobs.provider_task_id),
     detail = excluded.detail, error = excluded.error,
     attempts = excluded.attempts, updated_at = excluded.updated_at
   WHERE egoric_jobs.owner_email = excluded.owner_email
     AND egoric_jobs.project_id = excluded.project_id
     AND egoric_jobs.status NOT IN ('completed', 'cancelled')
     AND NOT (egoric_jobs.status = 'interrupted' AND excluded.status NOT IN ('interrupted', 'failed'))
     AND (
       excluded.updated_at > egoric_jobs.updated_at
       OR (
         excluded.updated_at = egoric_jobs.updated_at
         AND CASE excluded.status
           WHEN 'queued' THEN 0 WHEN 'running' THEN 1
           WHEN 'interrupted' THEN 2 WHEN 'failed' THEN 3
           WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 4
           ELSE -1 END
         >= CASE egoric_jobs.status
           WHEN 'queued' THEN 0 WHEN 'running' THEN 1
           WHEN 'interrupted' THEN 2 WHEN 'failed' THEN 3
           WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 4
           ELSE -1 END
       )
     )`}`
).bind(
  job.id, email, projectId, job.kind, job.stage, String(job.label || 'Tác vụ').slice(0, 240), job.status,
  Math.max(0, Math.min(100, Number(job.progress) || 0)),
  Number.isFinite(Number(job.completedUnits)) ? Math.max(0, Number(job.completedUnits)) : null,
  Number.isFinite(Number(job.totalUnits)) ? Math.max(0, Number(job.totalUnits)) : null,
  String(job.resourceId || '').slice(0, 180) || null,
  cleanText(job.idempotencyKey, 240) || null,
  cleanText(job.providerTaskId, 240) || null,
  String(job.detail || '').slice(0, 1000) || null,
  String(job.error || '').slice(0, 1000) || null,
  Math.max(0, Number(job.attempts) || 0),
  Math.max(0, Number(job.createdAt) || Date.now()),
  Math.min(Date.now(), Math.max(0, Number(job.updatedAt) || Date.now())),
);

async function handleJobsApi(request, env, url) {
  if (!env.DB) return json({ error: 'Workspace chưa được cấp cơ sở dữ liệu.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để dùng hàng đợi bền vững.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT ${JOB_SELECT_COLUMNS}
       FROM egoric_jobs WHERE owner_email = ? AND project_id = ?
       ORDER BY updated_at DESC LIMIT 100`
    ).bind(email, projectId).all();
    return json({ jobs: result.results || [] });
  }

  if (request.method === 'POST') {
    const payload = await request.json();
    const job = payload?.job;
    const idempotencyKey = cleanText(job?.idempotencyKey, 240);
    if (!isValidProductionJob(job) || !idempotencyKey) {
      return json({ error: 'Tác vụ billable hoặc khóa chống trùng không hợp lệ.' }, 400);
    }

    const findExisting = () => env.DB.prepare(
      `SELECT ${JOB_SELECT_COLUMNS} FROM egoric_jobs
       WHERE owner_email = ? AND project_id = ? AND idempotency_key = ?
         AND status IN ('queued', 'running', 'completed', 'interrupted')
       ORDER BY updated_at DESC LIMIT 1`
    ).bind(email, projectId, idempotencyKey).first();
    const existing = await findExisting();
    if (existing) return json({ claimed: false, existing }, 409);

    const result = await prepareProductionJobWrite(env, email, projectId, job, true).run();
    const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
    if (changes < 1) {
      return json({ claimed: false, existing: await findExisting() }, 409);
    }
    return json({ claimed: true, job }, 201);
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs.slice(0, 100) : [];
    if (!jobs.length) return json({ saved: 0 });
    const statements = [];
    for (const job of jobs) {
      if (!isValidProductionJob(job)) {
        return json({ error: 'Hàng đợi chứa tác vụ không hợp lệ.' }, 400);
      }
      statements.push(prepareProductionJobWrite(env, email, projectId, job));
    }
    await env.DB.batch(statements);
    return json({ saved: statements.length });
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare(
      `DELETE FROM egoric_jobs WHERE owner_email = ? AND project_id = ? AND status IN ('completed', 'cancelled')`
    ).bind(email, projectId).run();
    return json({ deleted: true });
  }

  return json({ error: 'Jobs route không tồn tại.' }, 404);
}

async function handleReviewsApi(request, env, url) {
  if (!env.DB) return json({ error: 'Workspace chưa được cấp cơ sở dữ liệu.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để dùng sổ duyệt.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);
  const stages = new Set(['script', 'assets', 'voice', 'director', 'export']);

  if (request.method === 'GET') {
    const [notes, approvals] = await Promise.all([
      env.DB.prepare(
        `SELECT id, shot_id AS shotId, stage, body, status, created_at AS createdAt, updated_at AS updatedAt
         FROM egoric_review_notes WHERE owner_email = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 200`
      ).bind(email, projectId).all(),
      env.DB.prepare(
        `SELECT stage, status, note, approved_by AS approvedBy, updated_at AS updatedAt
         FROM egoric_stage_approvals WHERE owner_email = ? AND project_id = ?`
      ).bind(email, projectId).all(),
    ]);
    return json({ notes: notes.results || [], approvals: approvals.results || [] });
  }

  if (request.method === 'POST') {
    const payload = await request.json();
    const stage = stages.has(payload?.stage) ? payload.stage : null;
    const body = String(payload?.body || '').trim().slice(0, 2000);
    const shotId = String(payload?.shotId || '').trim().slice(0, 160) || null;
    if (!stage || !body) return json({ error: 'Nội dung ghi chú duyệt không hợp lệ.' }, 400);
    const now = Date.now();
    const id = `review_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO egoric_review_notes (id, owner_email, project_id, shot_id, stage, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(id, email, projectId, shotId, stage, body, now, now).run();
    return json({ note: { id, shotId, stage, body, status: 'open', createdAt: now, updatedAt: now } }, 201);
  }

  if (request.method === 'PATCH') {
    const payload = await request.json();
    const id = /^[a-zA-Z0-9_-]{6,160}$/.test(payload?.id || '') ? payload.id : null;
    const status = ['open', 'resolved'].includes(payload?.status) ? payload.status : null;
    if (!id || !status) return json({ error: 'Trạng thái ghi chú không hợp lệ.' }, 400);
    await env.DB.prepare(
      'UPDATE egoric_review_notes SET status = ?, updated_at = ? WHERE id = ? AND owner_email = ? AND project_id = ?'
    ).bind(status, Date.now(), id, email, projectId).run();
    return json({ updated: true });
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const stage = stages.has(payload?.stage) ? payload.stage : null;
    const status = ['pending', 'changes-requested', 'approved'].includes(payload?.status) ? payload.status : null;
    if (!stage || !status) return json({ error: 'Trạng thái duyệt công đoạn không hợp lệ.' }, 400);
    const now = Date.now();
    const note = String(payload?.note || '').trim().slice(0, 1000) || null;
    await env.DB.prepare(
      `INSERT INTO egoric_stage_approvals (owner_email, project_id, stage, status, note, approved_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, project_id, stage) DO UPDATE SET
         status = excluded.status, note = excluded.note, approved_by = excluded.approved_by, updated_at = excluded.updated_at`
    ).bind(email, projectId, stage, status, note, email, now).run();
    return json({ approval: { stage, status, note, approvedBy: email, updatedAt: now } });
  }

  return json({ error: 'Review route không tồn tại.' }, 404);
}

const mapClientReviewComment = (row) => ({
  id: row.id,
  versionId: row.versionId ?? row.version_id,
  clipId: row.clipId ?? row.clip_id,
  authorName: row.authorName ?? row.author_name,
  authorEmail: row.authorEmail ?? row.author_email ?? undefined,
  body: row.body,
  timecodeSeconds: Number(row.timecodeSeconds ?? row.timecode_seconds ?? 0),
  status: row.status,
  createdAt: Number(row.createdAt ?? row.created_at),
  updatedAt: Number(row.updatedAt ?? row.updated_at),
});

const publicReviewAssetUrl = (token, mediaPath) => `/api/client-review/${encodeURIComponent(token)}/media/${mediaPath.split('/').map(encodeURIComponent).join('/')}`;

const hydrateClientReviewPortal = (row, comments, requestUrl) => {
  let payload = { versions: [] };
  try { payload = JSON.parse(row.payload_json || '{}'); } catch { /* Trả portal rỗng thay vì làm hỏng trang duyệt. */ }
  const token = row.token;
  const versions = Array.isArray(payload.versions) ? payload.versions.map((version) => ({
    id: version.id,
    number: Number(version.number || 1),
    label: version.label || `Phiên bản ${version.number || 1}`,
    note: version.note || undefined,
    duration: Number(version.duration || 0),
    internalRoundId: version.internalRoundId || undefined,
    artifactSignature: version.artifactSignature || undefined,
    sourceKind: version.sourceKind === 'master' ? 'master' : 'shots',
    masterOutputId: version.masterOutputId || undefined,
    artifactChecksum: version.artifactChecksum || undefined,
    artifactBytes: Number(version.artifactBytes || 0) || undefined,
    aspectRatio: version.aspectRatio || undefined,
    createdAt: Number(version.createdAt || row.created_at),
    clips: Array.isArray(version.clips) ? version.clips.map((clip) => ({
      id: clip.id,
      shotId: clip.shotId,
      title: clip.title,
      actionSummary: clip.actionSummary || '',
      duration: Number(clip.duration || 0),
      videoUrl: clip.mediaPath ? publicReviewAssetUrl(token, clip.mediaPath) : clip.externalUrl,
      posterUrl: clip.posterPath ? publicReviewAssetUrl(token, clip.posterPath) : clip.posterExternalUrl || undefined,
    })).filter((clip) => Boolean(clip.videoUrl)) : [],
  })) : [];
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    clientName: row.client_name,
    campaignName: row.campaign_name || undefined,
    deliverableTitle: row.deliverable_title || undefined,
    status: row.status,
    decision: row.decision,
    decisionVersionId: row.decision_version_id || undefined,
    decisionArtifactSignature: row.decision_artifact_signature || undefined,
    decisionNote: row.decision_note || undefined,
    reviewerName: row.reviewer_name || undefined,
    reviewerEmail: row.reviewer_email || undefined,
    decidedAt: row.decided_at ? Number(row.decided_at) : undefined,
    expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
    versions,
    comments: comments.map(mapClientReviewComment),
    shareUrl: `${new URL(requestUrl).origin}/?review=${encodeURIComponent(token)}`,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
};

const loadClientReviewPortal = async (env, row, requestUrl) => {
  const comments = await env.DB.prepare(
    `SELECT id, version_id AS versionId, clip_id AS clipId, author_name AS authorName,
            author_email AS authorEmail, body, timecode_seconds AS timecodeSeconds,
            status, created_at AS createdAt, updated_at AS updatedAt
     FROM egoric_client_review_comments WHERE portal_id = ? ORDER BY updated_at DESC LIMIT 500`
  ).bind(row.id).all();
  return hydrateClientReviewPortal(row, comments.results || [], requestUrl);
};

const reviewSourceSignature = (project, shotIds, masterOutputId) => {
  const shots = new Map((Array.isArray(project.shots) ? project.shots : []).map((shot) => [shot.id, shot]));
  const master = masterOutputId
    ? (project.autoEditor?.outputs || []).find((output) => output?.id === masterOutputId
      && output?.status === 'ready'
      && output?.storage === 'cloud'
      && output?.videoUrl
      && output?.checksum)
    : undefined;
  const payload = {
    shotIds,
    planSignature: project.autoEditor?.planSignature,
    editorSettings: project.autoEditor?.settings,
    master: master ? {
      id: master.id,
      status: master.status,
      storage: master.storage,
      videoUrl: master.videoUrl,
      checksum: master.checksum,
      bytes: master.bytes,
      aspectRatio: master.aspectRatio,
      renderedAt: master.renderedAt,
      archivedAt: master.archivedAt,
    } : undefined,
    clips: shotIds.map((shotId) => {
      const shot = shots.get(shotId);
      const voiceTakeId = project.voiceStudio?.selectedTakeByShot?.[shotId];
      const voice = (project.voiceStudio?.takes || []).find((take) => take.id === voiceTakeId);
      return {
        shotId,
        videoUrl: shot?.interval?.videoUrl,
        duration: shot?.interval?.duration,
        videoStale: shot?.workflow?.videoStale,
        dialogue: shot?.dialogue,
        voiceTakeId,
        voiceUrl: voice?.audioUrl,
      };
    }),
  };
  const value = JSON.stringify(payload);
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
};

const buildReviewVersion = (project, reviewRound, label, note, number) => {
  const versionId = `version_${crypto.randomUUID()}`;
  const master = reviewRound.masterOutputId
    ? (project.autoEditor?.outputs || []).find((output) => output?.id === reviewRound.masterOutputId)
    : undefined;
  if (master?.status === 'ready' && master?.storage === 'cloud' && master?.videoUrl && master?.checksum) {
    const mediaPath = getCloudMediaPath(project.id, master.videoUrl);
    const externalUrl = mediaPath ? null : getExternalMediaUrl(master.videoUrl);
    const duration = Math.max(1, Math.min(7200, (project.autoEditor?.timeline || []).reduce((sum, clip) => sum + (Number(clip?.duration) || 0), 0) || 10));
    const artifactSignature = `master:${master.id}:${master.checksum}`;
    return {
      id: versionId,
      number,
      label: cleanText(label, 120) || `Phiên bản ${number}`,
      note: cleanText(note, 1000) || undefined,
      duration,
      clips: mediaPath || externalUrl ? [{
        id: `clip_${versionId}_master`,
        shotId: master.id,
        title: `Master ${master.aspectRatio || ''}`.trim(),
        actionSummary: 'Bản dựng hoàn chỉnh đã khóa checksum để khách hàng nghiệm thu.',
        duration,
        mediaPath: mediaPath || undefined,
        externalUrl: externalUrl || undefined,
      }] : [],
      internalRoundId: reviewRound.id,
      artifactSignature,
      sourceKind: 'master',
      masterOutputId: master.id,
      artifactChecksum: master.checksum,
      artifactBytes: Number(master.bytes || 0) || undefined,
      aspectRatio: master.aspectRatio,
      createdAt: Date.now(),
    };
  }
  const allowedShotIds = new Set(reviewRound.shotIds);
  const clips = (Array.isArray(project.shots) ? project.shots : []).flatMap((shot, index) => {
    if (!allowedShotIds.has(shot?.id)) return [];
    const videoValue = shot?.interval?.videoUrl;
    const mediaPath = getCloudMediaPath(project.id, videoValue);
    const externalUrl = mediaPath ? null : getExternalMediaUrl(videoValue);
    if (!mediaPath && !externalUrl) return [];
    const posterValue = (Array.isArray(shot.keyframes) ? shot.keyframes : []).find((frame) => frame?.type === 'start' && frame?.imageUrl)?.imageUrl;
    const posterPath = getCloudMediaPath(project.id, posterValue);
    const posterExternalUrl = posterPath ? null : getExternalMediaUrl(posterValue);
    const duration = Math.max(1, Math.min(600, Number(shot?.interval?.duration) || 10));
    return [{
      id: `clip_${versionId}_${index + 1}`,
      shotId: cleanText(shot.id, 160) || `shot_${index + 1}`,
      title: `Cảnh ${String(index + 1).padStart(2, '0')}`,
      actionSummary: cleanText(shot.actionSummary, 500),
      duration,
      mediaPath: mediaPath || undefined,
      externalUrl: externalUrl || undefined,
      posterPath: posterPath || undefined,
      posterExternalUrl: posterExternalUrl || undefined,
    }];
  });
  const artifactSignature = `shots:${reviewSourceSignature(project, reviewRound.shotIds)}`;
  return {
    id: versionId,
    number,
    label: cleanText(label, 120) || `Phiên bản ${number}`,
    note: cleanText(note, 1000) || undefined,
    duration: clips.reduce((sum, clip) => sum + clip.duration, 0),
    clips,
    internalRoundId: reviewRound.id,
    artifactSignature,
    sourceKind: 'shots',
    createdAt: Date.now(),
  };
};

async function handleClientReviewsApi(request, env, url) {
  if (!env.DB || !env.MEDIA) return json({ error: 'Cổng duyệt chưa được cấp D1/R2.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để quản lý link duyệt.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT * FROM egoric_client_review_portals WHERE owner_email = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20'
    ).bind(email, projectId).all();
    const portals = await Promise.all((rows.results || []).map((row) => loadClientReviewPortal(env, row, request.url)));
    return json({ portals });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const projectRow = await env.DB.prepare(
      'SELECT payload_json AS payload FROM egoric_projects WHERE owner_email = ? AND project_id = ?'
    ).bind(email, projectId).first();
    if (!projectRow) return json({ error: 'Hãy sao lưu dự án lên cloud trước khi phát hành bản duyệt.' }, 409);
    let project;
    try { project = JSON.parse(projectRow.payload); } catch { return json({ error: 'Bản sao dự án cloud bị lỗi dữ liệu.' }, 500); }

    const internalRoundId = safeReviewId(body?.internalRoundId);
    const reviewState = project?.agencyReview;
    const reviewRound = Array.isArray(reviewState?.rounds)
      ? reviewState.rounds.find((round) => round?.id === internalRoundId && round?.id === reviewState.activeRoundId)
      : null;
    const allGatesApproved = ['director', 'editor', 'account'].every((role) => reviewRound?.gates?.find((gate) => gate.role === role)?.status === 'approved');
    if (!reviewRound || reviewRound.status !== 'ready-client' || !allGatesApproved) {
      return json({ error: 'Phiên bản chưa hoàn tất vòng duyệt Director → Editor → Account.' }, 409);
    }
    if (!Array.isArray(reviewRound.shotIds) || !reviewRound.shotIds.length || reviewRound.sourceSignature !== reviewSourceSignature(project, reviewRound.shotIds, reviewRound.masterOutputId)) {
      return json({ error: 'Media đã thay đổi sau vòng duyệt nội bộ. Hãy mở vòng duyệt mới.' }, 409);
    }
    const requestedMasterId = safeReviewId(body?.masterOutputId);
    if ((reviewRound.masterOutputId || null) !== (requestedMasterId || null)) {
      return json({ error: 'Master gửi duyệt không trùng với bản đã được duyệt nội bộ.' }, 409);
    }

    const existing = await env.DB.prepare(
      'SELECT * FROM egoric_client_review_portals WHERE owner_email = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(email, projectId).first();
    let currentPayload = { versions: [] };
    if (existing) {
      try { currentPayload = JSON.parse(existing.payload_json || '{}'); } catch { currentPayload = { versions: [] }; }
    }
    const versions = Array.isArray(currentPayload.versions) ? currentPayload.versions : [];
    const nextNumber = versions.reduce((highest, version) => Math.max(highest, Number(version.number) || 0), 0) + 1;
    const version = buildReviewVersion(project, reviewRound, body?.versionLabel, body?.versionNote, nextNumber);
    if (!version.clips.length) return json({ error: 'Dự án cloud chưa có video có thể chia sẻ. Hãy tạo video rồi sao lưu lại.' }, 409);
    const nextPayload = JSON.stringify({ versions: [...versions, version].slice(-20) });
    const now = Date.now();
    const expiresInDays = Math.max(1, Math.min(365, Number(body?.expiresInDays) || 30));
    const expiresAt = now + expiresInDays * 86400000;
    const title = cleanText(body?.title, 240) || cleanText(project.title, 240) || 'Bản duyệt video';
    const clientName = cleanText(body?.clientName, 160) || 'Khách hàng';
    const campaignName = cleanText(body?.campaignName, 240) || null;
    const deliverableTitle = cleanText(body?.deliverableTitle, 240) || null;

    let portalId;
    if (existing) {
      portalId = existing.id;
      await env.DB.prepare(
        `UPDATE egoric_client_review_portals SET title = ?, client_name = ?, campaign_name = ?, deliverable_title = ?,
          status = 'active', decision = 'pending', decision_version_id = NULL, decision_artifact_signature = NULL, decision_note = NULL, reviewer_name = NULL, reviewer_email = NULL,
          decided_at = NULL, expires_at = ?, payload_json = ?, updated_at = ?
         WHERE id = ? AND owner_email = ? AND project_id = ?`
      ).bind(title, clientName, campaignName, deliverableTitle, expiresAt, nextPayload, now, portalId, email, projectId).run();
    } else {
      portalId = `portal_${crypto.randomUUID()}`;
      await env.DB.prepare(
        `INSERT INTO egoric_client_review_portals
          (id, token, owner_email, project_id, title, client_name, campaign_name, deliverable_title,
           status, decision, expires_at, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'pending', ?, ?, ?, ?)`
      ).bind(portalId, createReviewToken(), email, projectId, title, clientName, campaignName, deliverableTitle, expiresAt, nextPayload, now, now).run();
    }
    const row = await env.DB.prepare('SELECT * FROM egoric_client_review_portals WHERE id = ? AND owner_email = ?').bind(portalId, email).first();
    return json({ portal: await loadClientReviewPortal(env, row, request.url) }, existing ? 200 : 201);
  }

  if (request.method === 'PATCH') {
    const body = await request.json();
    const portalId = safeReviewId(body?.portalId);
    if (!portalId) return json({ error: 'Cổng duyệt không hợp lệ.' }, 400);
    const row = await env.DB.prepare(
      'SELECT * FROM egoric_client_review_portals WHERE id = ? AND owner_email = ? AND project_id = ?'
    ).bind(portalId, email, projectId).first();
    if (!row) return json({ error: 'Không tìm thấy cổng duyệt.' }, 404);
    const statements = [];
    if (['active', 'closed'].includes(body?.status)) {
      statements.push(env.DB.prepare(
        'UPDATE egoric_client_review_portals SET status = ?, updated_at = ? WHERE id = ? AND owner_email = ?'
      ).bind(body.status, Date.now(), portalId, email));
    }
    if (body?.resetDecision === true) {
      statements.push(env.DB.prepare(
        `UPDATE egoric_client_review_portals SET status = 'active', decision = 'pending', decision_version_id = NULL, decision_artifact_signature = NULL, decision_note = NULL,
          reviewer_name = NULL, reviewer_email = NULL, decided_at = NULL, updated_at = ? WHERE id = ? AND owner_email = ?`
      ).bind(Date.now(), portalId, email));
    }
    const commentId = safeReviewId(body?.commentId);
    if (commentId && ['open', 'resolved'].includes(body?.commentStatus)) {
      statements.push(env.DB.prepare(
        'UPDATE egoric_client_review_comments SET status = ?, updated_at = ? WHERE id = ? AND portal_id = ?'
      ).bind(body.commentStatus, Date.now(), commentId, portalId));
    }
    if (!statements.length) return json({ error: 'Không có thay đổi hợp lệ.' }, 400);
    await env.DB.batch(statements);
    const updated = await env.DB.prepare('SELECT * FROM egoric_client_review_portals WHERE id = ? AND owner_email = ?').bind(portalId, email).first();
    return json({ portal: await loadClientReviewPortal(env, updated, request.url) });
  }

  return json({ error: 'Client review route không tồn tại.' }, 404);
}

const DISTRIBUTION_PLATFORM_RULES = {
  tiktok: ['9:16'],
  youtube: ['16:9', '9:16', '1:1'],
  'instagram-reels': ['9:16'],
  'facebook-reels': ['9:16'],
};

const hydrateDistributionPackage = (row) => {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch { /* Bản ghi lỗi vẫn được trả với metadata tối thiểu. */ }
  return {
    ...payload,
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    reviewPortalId: row.review_portal_id,
    reviewVersionId: row.review_version_id,
    reviewRoundId: row.review_round_id,
    masterOutputId: row.master_output_id,
    masterChecksum: row.master_checksum,
    artifactSignature: row.artifact_signature,
    approvalFingerprint: row.artifact_signature,
    idempotencyKey: row.idempotency_key,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
};

async function handleDistributionPackagesApi(request, env, url) {
  if (!env.DB || !env.MEDIA) return json({ error: 'Distribution Gateway chưa được cấp D1/R2.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để quản lý gói phát hành.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);

  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT * FROM egoric_distribution_packages WHERE owner_email = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 100'
    ).bind(email, projectId).all();
    return json({ packages: (rows.results || []).map(hydrateDistributionPackage) });
  }

  if (request.method !== 'POST') return json({ error: 'Distribution Gateway chỉ nhận GET hoặc POST.' }, 405);

  const body = await request.json();
  const requestedPlatforms = Array.from(new Set(Array.isArray(body?.platforms) ? body.platforms : []));
  const platforms = requestedPlatforms.filter((platform) => Object.prototype.hasOwnProperty.call(DISTRIBUTION_PLATFORM_RULES, platform));
  if (!platforms.length || platforms.length !== requestedPlatforms.length) {
    return json({ error: 'Hãy chọn ít nhất một nền tảng phân phối hợp lệ.' }, 400);
  }

  const projectRow = await env.DB.prepare(
    'SELECT payload_json AS payload FROM egoric_projects WHERE owner_email = ? AND project_id = ?'
  ).bind(email, projectId).first();
  if (!projectRow) return json({ error: 'Hãy sao lưu dự án lên cloud trước khi tạo package.' }, 409);
  let project;
  try { project = JSON.parse(projectRow.payload); } catch { return json({ error: 'Bản sao dự án cloud bị lỗi dữ liệu.' }, 500); }

  const reviewRoundId = safeReviewId(body?.reviewRoundId);
  const reviewPortalId = safeReviewId(body?.reviewPortalId);
  const reviewVersionId = safeReviewId(body?.reviewVersionId);
  const masterOutputId = safeReviewId(body?.masterOutputId);
  if (!reviewRoundId || !reviewPortalId || !reviewVersionId || !masterOutputId) {
    return json({ error: 'Package thiếu định danh vòng duyệt, version hoặc master.' }, 400);
  }

  const reviewRound = (project?.agencyReview?.rounds || []).find((round) => round?.id === reviewRoundId);
  const allGatesApproved = ['director', 'editor', 'account'].every((role) => reviewRound?.gates?.find((gate) => gate.role === role)?.status === 'approved');
  if (!reviewRound || !allGatesApproved || !['client-review', 'approved'].includes(reviewRound.status)) {
    return json({ error: 'Package bị chặn: vòng Director → Editor → Account chưa hoàn tất hoặc chưa gửi khách.' }, 409);
  }
  if (reviewRound.portalId !== reviewPortalId || reviewRound.versionId !== reviewVersionId || reviewRound.masterOutputId !== masterOutputId) {
    return json({ error: 'Package bị chặn: portal, version hoặc master không trùng vòng duyệt.' }, 409);
  }
  if (!Array.isArray(reviewRound.shotIds) || !reviewRound.shotIds.length || reviewRound.sourceSignature !== reviewSourceSignature(project, reviewRound.shotIds, masterOutputId)) {
    return json({ error: 'Package bị chặn: nguồn dựng đã thay đổi sau vòng duyệt.' }, 409);
  }

  const master = (project.autoEditor?.outputs || []).find((output) => output?.id === masterOutputId);
  const masterMediaPath = getCloudMediaPath(projectId, master?.videoUrl);
  if (!master || master.status !== 'ready' || master.storage !== 'cloud' || !master.checksum || !masterMediaPath) {
    return json({ error: 'Package bị chặn: master cloud không còn hợp lệ.' }, 409);
  }
  if (reviewRound.masterChecksum !== master.checksum) {
    return json({ error: 'Package bị chặn: checksum master đã đổi sau vòng duyệt.' }, 409);
  }
  if (platforms.some((platform) => !DISTRIBUTION_PLATFORM_RULES[platform].includes(master.aspectRatio))) {
    return json({ error: `Tỷ lệ ${master.aspectRatio || 'không xác định'} không tương thích với toàn bộ nền tảng đã chọn.` }, 409);
  }

  const portalRow = await env.DB.prepare(
    'SELECT * FROM egoric_client_review_portals WHERE id = ? AND owner_email = ? AND project_id = ?'
  ).bind(reviewPortalId, email, projectId).first();
  if (!portalRow || portalRow.decision !== 'approved' || portalRow.decision_version_id !== reviewVersionId) {
    return json({ error: 'Package bị chặn: khách hàng chưa phê duyệt đúng version.' }, 409);
  }
  let reviewPayload = { versions: [] };
  try { reviewPayload = JSON.parse(portalRow.payload_json || '{}'); } catch { return json({ error: 'Dữ liệu version khách duyệt bị lỗi.' }, 500); }
  const reviewVersion = (reviewPayload.versions || []).find((version) => version?.id === reviewVersionId);
  const expectedArtifactSignature = `master:${master.id}:${master.checksum}`;
  if (!reviewVersion
    || reviewVersion.sourceKind !== 'master'
    || reviewVersion.masterOutputId !== master.id
    || reviewVersion.artifactChecksum !== master.checksum
    || reviewVersion.artifactSignature !== expectedArtifactSignature
    || portalRow.decision_artifact_signature !== expectedArtifactSignature) {
    return json({ error: 'Package bị chặn: fingerprint khách ký không trùng artifact hiện tại.' }, 409);
  }
  const openComment = await env.DB.prepare(
    `SELECT id FROM egoric_client_review_comments
     WHERE portal_id = ? AND version_id = ? AND status = 'open' LIMIT 1`
  ).bind(reviewPortalId, reviewVersionId).first();
  if (openComment) return json({ error: 'Package bị chặn: version đã duyệt vẫn còn góp ý chưa xử lý.' }, 409);

  const name = cleanText(body?.name, 120);
  const title = cleanText(body?.title, 240);
  const caption = cleanText(body?.caption, 2200) || undefined;
  if (!name || !title) return json({ error: 'Tên package và tiêu đề phát hành là bắt buộc.' }, 400);
  const orderedPlatforms = [...platforms].sort();
  const idempotencyKey = await hashText(JSON.stringify({ expectedArtifactSignature, orderedPlatforms, name, title, caption }));
  const existing = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_packages WHERE owner_email = ? AND project_id = ? AND idempotency_key = ?'
  ).bind(email, projectId, idempotencyKey).first();
  if (existing) return json({ package: hydrateDistributionPackage(existing), duplicate: true });

  const now = Date.now();
  const id = `distribution_${crypto.randomUUID()}`;
  const packagePayload = {
    id,
    projectId,
    name,
    status: 'ready',
    reviewRoundId,
    reviewPortalId,
    reviewVersionId,
    masterOutputId,
    masterChecksum: master.checksum,
    artifactSignature: expectedArtifactSignature,
    approvalFingerprint: expectedArtifactSignature,
    masterVideoUrl: `/api/cloud/media/${encodeURIComponent(projectId)}/${masterMediaPath.split('/').map(encodeURIComponent).join('/')}`,
    aspectRatio: master.aspectRatio,
    artifactBytes: Number(master.bytes || reviewVersion.artifactBytes || 0) || undefined,
    duration: Number(reviewVersion.duration || 0) || undefined,
    title,
    caption,
    targets: orderedPlatforms.map((platform) => ({ platform, status: 'ready', updatedAt: now })),
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  await env.DB.prepare(
    `INSERT INTO egoric_distribution_packages
      (id, owner_email, project_id, review_portal_id, review_version_id, review_round_id,
       master_output_id, master_checksum, artifact_signature, idempotency_key, status, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`
  ).bind(id, email, projectId, reviewPortalId, reviewVersionId, reviewRoundId, masterOutputId, master.checksum,
    expectedArtifactSignature, idempotencyKey, JSON.stringify(packagePayload), now, now).run();
  return json({ package: packagePayload, duplicate: false }, 201);
}

const DISTRIBUTION_OAUTH_PLATFORMS = new Set(['youtube', 'tiktok']);
const DISTRIBUTION_JOB_STATUSES = new Set(['queued', 'uploading', 'processing', 'awaiting-user', 'published', 'failed', 'indeterminate', 'cancelled']);
const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
const TIKTOK_CHUNK_BYTES = 10 * 1024 * 1024;

const distributionAdapterReadiness = (env, platform, connectionCount = 0) => {
  if (platform === 'youtube') {
    const configured = Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && String(env.DISTRIBUTION_TOKEN_KEY || '').length >= 32);
    return {
      platform, configured, mode: 'resumable-upload', connectionCount,
      blocker: configured ? undefined : 'Cần YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET và DISTRIBUTION_TOKEN_KEY trên server.',
    };
  }
  if (platform === 'tiktok') {
    const configured = Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && String(env.DISTRIBUTION_TOKEN_KEY || '').length >= 32);
    return {
      platform, configured, mode: 'creator-inbox', connectionCount,
      blocker: configured ? undefined : 'Cần TikTok Login Kit, quyền video.upload và khóa mã hóa token trên server.',
    };
  }
  return {
    platform, configured: false, mode: 'app-review', connectionCount,
    blocker: 'Adapter Meta đang khóa cho tới khi App Review và Page/Instagram permissions được phê duyệt.',
  };
};

const bytesToBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const base64UrlToBytes = (value) => {
  const padded = String(value || '').replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((String(value || '').length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const distributionTokenKey = async (env) => {
  const secret = String(env.DISTRIBUTION_TOKEN_KEY || '');
  if (secret.length < 32) throw new Error('Server chưa có khóa mã hóa token phân phối tối thiểu 32 ký tự.');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

const encryptDistributionSecret = async (env, value) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await distributionTokenKey(env), new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`;
};

const decryptDistributionSecret = async (env, value) => {
  const [version, iv, ciphertext] = String(value || '').split(':');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Token kết nối bị lỗi định dạng.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) }, await distributionTokenKey(env), base64UrlToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
};

const createOauthState = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const safeDistributionPlatform = (value) => Object.prototype.hasOwnProperty.call(DISTRIBUTION_PLATFORM_RULES, value) ? value : null;
const safeDistributionId = (value, prefix) => new RegExp(`^${prefix}_[a-zA-Z0-9-]{8,180}$`).test(value || '') ? value : null;

const hydrateDistributionConnection = (row) => {
  let scopes = [];
  try { scopes = JSON.parse(row.scopes_json || '[]'); } catch { /* Không lộ secret vì metadata lỗi. */ }
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    scopes: Array.isArray(scopes) ? scopes : [],
    expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
    lastVerifiedAt: row.last_verified_at ? Number(row.last_verified_at) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
};

const hydrateDistributionJob = (row) => {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch { /* Trả metadata tối thiểu để operator còn thấy lỗi. */ }
  return {
    ...payload,
    id: row.id,
    projectId: row.project_id,
    packageId: row.package_id,
    platform: row.platform,
    connectionId: row.connection_id,
    status: DISTRIBUTION_JOB_STATUSES.has(row.status) ? row.status : 'failed',
    attempt: Number(row.attempt || 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
};

const readExternalPayload = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
};

const externalErrorMessage = (payload, fallback) => cleanText(
  payload?.error?.message || payload?.error_description || payload?.message || payload?.error?.code || fallback,
  500,
);

async function upsertDistributionConnection(env, email, platform, externalAccountId, displayName, scopes, tokenPayload, expiresAt) {
  const existing = await env.DB.prepare(
    'SELECT id, created_at FROM egoric_distribution_connections WHERE owner_email = ? AND platform = ? AND external_account_id = ?'
  ).bind(email, platform, externalAccountId).first();
  const now = Date.now();
  const id = existing?.id || `connection_${crypto.randomUUID()}`;
  const secret = await encryptDistributionSecret(env, tokenPayload);
  await env.DB.prepare(
    `INSERT INTO egoric_distribution_connections
      (id, owner_email, platform, external_account_id, display_name, status, scopes_json, secret_json, expires_at, last_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, platform, external_account_id) DO UPDATE SET
       display_name = excluded.display_name, status = 'connected', scopes_json = excluded.scopes_json,
       secret_json = excluded.secret_json, expires_at = excluded.expires_at,
       last_verified_at = excluded.last_verified_at, updated_at = excluded.updated_at`
  ).bind(
    id, email, platform, externalAccountId, displayName || externalAccountId,
    JSON.stringify(scopes || []), secret, expiresAt || null, now, Number(existing?.created_at || now), now,
  ).run();
  return id;
}

async function handleDistributionOauthStart(request, env, url) {
  if (!env.DB) return json({ error: 'OAuth phân phối chưa được cấp D1.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập trước khi kết nối tài khoản nền tảng.' }, 401);
  const platform = safeDistributionPlatform(url.searchParams.get('platform'));
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!platform || !projectId || !DISTRIBUTION_OAUTH_PLATFORMS.has(platform)) return json({ error: 'Nền tảng OAuth không hợp lệ.' }, 400);
  const readiness = distributionAdapterReadiness(env, platform);
  if (!readiness.configured) return json({ error: readiness.blocker }, 503);

  const state = createOauthState();
  const stateHash = await hashText(state);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM egoric_distribution_oauth_states WHERE expires_at < ?').bind(now),
    env.DB.prepare(
      `INSERT INTO egoric_distribution_oauth_states
       (state_hash, owner_email, project_id, platform, return_path, expires_at, created_at)
       VALUES (?, ?, ?, ?, '/', ?, ?)`
    ).bind(stateHash, email, projectId, platform, now + 10 * 60_000, now),
  ]);
  const callbackUrl = `${url.origin}/api/distribution-oauth/callback/${platform}`;
  let authorizeUrl;
  if (platform === 'youtube') {
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.searchParams.set('client_id', env.YOUTUBE_CLIENT_ID);
    target.searchParams.set('redirect_uri', callbackUrl);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
    target.searchParams.set('access_type', 'offline');
    target.searchParams.set('include_granted_scopes', 'true');
    target.searchParams.set('prompt', 'consent');
    target.searchParams.set('state', state);
    authorizeUrl = target.toString();
  } else {
    const target = new URL('https://www.tiktok.com/v2/auth/authorize/');
    target.searchParams.set('client_key', env.TIKTOK_CLIENT_KEY);
    target.searchParams.set('redirect_uri', callbackUrl);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('scope', 'user.info.basic,video.upload');
    target.searchParams.set('state', state);
    authorizeUrl = target.toString();
  }
  return json({ authorizeUrl });
}

const oauthResultRedirect = (url, platform, result, detail) => {
  const target = new URL('/', url.origin);
  target.searchParams.set('distributionOAuth', result);
  target.searchParams.set('platform', platform || 'unknown');
  if (detail) target.searchParams.set('detail', cleanText(detail, 160));
  const message = JSON.stringify({
    type: 'egoric:distribution-oauth', result, platform: platform || 'unknown', detail: detail ? cleanText(detail, 160) : undefined,
  }).replaceAll('<', '\\u003c');
  const fallback = JSON.stringify(target.toString()).replaceAll('<', '\\u003c');
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Egoric · OAuth</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07090c;color:#e4e4e7;font:14px system-ui"><p>Đã xử lý kết nối. Cửa sổ này sẽ tự đóng…</p><script>const message=${message};const fallback=${fallback};if(window.opener){window.opener.postMessage(message,location.origin);window.close();setTimeout(()=>location.replace(fallback),700)}else{location.replace(fallback)}</script></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
};

async function handleDistributionOauthCallback(request, env, url) {
  if (!env.DB) return oauthResultRedirect(url, 'unknown', 'error', 'D1 chưa sẵn sàng');
  const match = url.pathname.match(/^\/api\/distribution-oauth\/callback\/(youtube|tiktok)$/);
  const platform = match?.[1];
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!platform || !state) return oauthResultRedirect(url, platform, 'error', 'OAuth state không hợp lệ');
  const stateHash = await hashText(state);
  const row = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_oauth_states WHERE state_hash = ? AND platform = ?'
  ).bind(stateHash, platform).first();
  if (!row || Number(row.expires_at) < Date.now()) return oauthResultRedirect(url, platform, 'error', 'Phiên kết nối đã hết hạn');
  await env.DB.prepare('DELETE FROM egoric_distribution_oauth_states WHERE state_hash = ?').bind(stateHash).run();
  if (url.searchParams.get('error') || !code) return oauthResultRedirect(url, platform, 'cancelled', 'Người dùng chưa cấp quyền');
  const callbackUrl = `${url.origin}/api/distribution-oauth/callback/${platform}`;

  try {
    if (platform === 'youtube') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET,
          code, grant_type: 'authorization_code', redirect_uri: callbackUrl,
        }),
      });
      const tokens = await readExternalPayload(tokenResponse);
      if (!tokenResponse.ok || !tokens.access_token) throw new Error(externalErrorMessage(tokens, 'Google không cấp access token.'));
      const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const channelPayload = await readExternalPayload(channelResponse);
      const channel = channelPayload?.items?.[0];
      if (!channelResponse.ok || !channel?.id) throw new Error(externalErrorMessage(channelPayload, 'Không tìm thấy kênh YouTube.'));
      const expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
      await upsertDistributionConnection(
        env, row.owner_email, platform, channel.id, channel.snippet?.title || 'YouTube channel',
        String(tokens.scope || '').split(' ').filter(Boolean), { ...tokens, expiresAt }, expiresAt,
      );
    } else {
      const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
          code, grant_type: 'authorization_code', redirect_uri: callbackUrl,
        }),
      });
      const tokens = await readExternalPayload(tokenResponse);
      if (!tokenResponse.ok || !tokens.access_token || !tokens.open_id) throw new Error(externalErrorMessage(tokens, 'TikTok không cấp access token.'));
      const profileResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profilePayload = await readExternalPayload(profileResponse);
      const profile = profilePayload?.data?.user || {};
      const expiresAt = Date.now() + Number(tokens.expires_in || 86400) * 1000;
      await upsertDistributionConnection(
        env, row.owner_email, platform, tokens.open_id, profile.display_name || 'TikTok creator',
        String(tokens.scope || '').split(',').filter(Boolean), { ...tokens, expiresAt }, expiresAt,
      );
    }
    return oauthResultRedirect(url, platform, 'success');
  } catch (error) {
    console.error('Distribution OAuth callback error', platform, error);
    return oauthResultRedirect(url, platform, 'error', error instanceof Error ? error.message : 'Kết nối thất bại');
  }
}

async function handleDistributionConnectionsApi(request, env, url) {
  if (!env.DB) return json({ error: 'Kết nối phân phối chưa được cấp D1.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập để quản lý tài khoản nền tảng.' }, 401);
  if (request.method !== 'DELETE') return json({ error: 'Route này chỉ nhận DELETE.' }, 405);
  const id = safeDistributionId(url.searchParams.get('id'), 'connection');
  if (!id) return json({ error: 'Mã kết nối không hợp lệ.' }, 400);
  const active = await env.DB.prepare(
    `SELECT id FROM egoric_distribution_jobs WHERE owner_email = ? AND connection_id = ?
     AND status IN ('queued', 'uploading', 'processing', 'indeterminate') LIMIT 1`
  ).bind(email, id).first();
  if (active) return json({ error: 'Không thể ngắt kết nối khi còn job đang chạy hoặc chưa đối soát.' }, 409);
  await env.DB.prepare(
    `UPDATE egoric_distribution_connections SET status = 'revoked', secret_json = '', updated_at = ?
     WHERE id = ? AND owner_email = ?`
  ).bind(Date.now(), id, email).run();
  return json({ success: true });
}

async function handleDistributionOperationsApi(request, env, url) {
  if (!env.DB) return json({ error: 'Hàng đợi phân phối chưa được cấp D1.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập để xem hàng đợi xuất bản.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);
  const [connections, jobs] = await Promise.all([
    env.DB.prepare(
      `SELECT id, platform, external_account_id, display_name, status, scopes_json, expires_at,
       last_verified_at, created_at, updated_at FROM egoric_distribution_connections
       WHERE owner_email = ? AND status != 'revoked' ORDER BY updated_at DESC LIMIT 100`
    ).bind(email).all(),
    env.DB.prepare(
      'SELECT * FROM egoric_distribution_jobs WHERE owner_email = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 200'
    ).bind(email, projectId).all(),
  ]);
  const publicConnections = (connections.results || []).map(hydrateDistributionConnection);
  const counts = publicConnections.reduce((result, item) => ({ ...result, [item.platform]: (result[item.platform] || 0) + 1 }), {});
  const adapters = Object.keys(DISTRIBUTION_PLATFORM_RULES).map((platform) => distributionAdapterReadiness(env, platform, counts[platform] || 0));
  return json({ connections: publicConnections, jobs: (jobs.results || []).map(hydrateDistributionJob), adapters });
}

async function getDistributionAccessToken(env, row) {
  if (row.status !== 'connected' || !row.secret_json) throw new Error('Tài khoản nền tảng đã hết hạn hoặc bị ngắt kết nối.');
  let tokens = await decryptDistributionSecret(env, row.secret_json);
  if (Number(tokens.expiresAt || row.expires_at || 0) > Date.now() + 60_000 && tokens.access_token) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Kết nối không có refresh token; hãy kết nối lại tài khoản.');
  let response;
  if (row.platform === 'youtube') {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      }),
    });
  } else if (row.platform === 'tiktok') {
    response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      }),
    });
  } else throw new Error('Adapter chưa hỗ trợ refresh token.');
  const refreshed = await readExternalPayload(response);
  if (!response.ok || !refreshed.access_token) {
    await env.DB.prepare(`UPDATE egoric_distribution_connections SET status = 'expired', updated_at = ? WHERE id = ?`).bind(Date.now(), row.id).run();
    throw new Error(externalErrorMessage(refreshed, 'Không thể làm mới access token.'));
  }
  const expiresAt = Date.now() + Number(refreshed.expires_in || 3600) * 1000;
  tokens = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token, expiresAt };
  await env.DB.prepare(
    `UPDATE egoric_distribution_connections SET secret_json = ?, expires_at = ?, status = 'connected', last_verified_at = ?, updated_at = ? WHERE id = ?`
  ).bind(await encryptDistributionSecret(env, tokens), expiresAt, Date.now(), Date.now(), row.id).run();
  return tokens.access_token;
}

const distributionTargetStatus = (status) => status === 'awaiting-user' ? 'awaiting-user' : status;

async function syncDistributionPackageFromJobs(env, email, packageId) {
  const packageRow = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_packages WHERE id = ? AND owner_email = ?'
  ).bind(packageId, email).first();
  if (!packageRow) return undefined;
  const rows = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_jobs WHERE owner_email = ? AND package_id = ? ORDER BY updated_at DESC'
  ).bind(email, packageId).all();
  const jobs = (rows.results || []).map(hydrateDistributionJob);
  const latestByPlatform = new Map();
  jobs.forEach((item) => { if (!latestByPlatform.has(item.platform)) latestByPlatform.set(item.platform, item); });
  const current = hydrateDistributionPackage(packageRow);
  const targets = (current.targets || []).map((target) => {
    const job = latestByPlatform.get(target.platform);
    if (!job) return target;
    return {
      ...target, status: distributionTargetStatus(job.status), accountId: job.connectionId,
      externalId: job.externalId, publishedUrl: job.publishedUrl, error: job.error, updatedAt: job.updatedAt,
    };
  });
  const statuses = targets.map((target) => target.status);
  const status = statuses.length && statuses.every((item) => item === 'published')
    ? 'published'
    : statuses.some((item) => ['failed', 'indeterminate'].includes(item))
      ? 'attention'
      : statuses.some((item) => ['queued', 'uploading', 'processing', 'awaiting-user'].includes(item)) ? 'processing' : 'ready';
  const updatedAt = Date.now();
  const payload = { ...current, targets, status, updatedAt };
  await env.DB.prepare(
    'UPDATE egoric_distribution_packages SET status = ?, payload_json = ?, updated_at = ? WHERE id = ? AND owner_email = ?'
  ).bind(status, JSON.stringify(payload), updatedAt, packageId, email).run();
  return payload;
}

async function persistDistributionJob(env, row, job, privateState) {
  const updatedAt = Date.now();
  const publicPayload = { ...job, updatedAt };
  delete publicPayload.id;
  delete publicPayload.projectId;
  delete publicPayload.packageId;
  delete publicPayload.platform;
  delete publicPayload.connectionId;
  delete publicPayload.status;
  delete publicPayload.attempt;
  delete publicPayload.createdAt;
  await env.DB.prepare(
    `UPDATE egoric_distribution_jobs SET status = ?, attempt = ?, payload_json = ?, private_json = ?, updated_at = ?
     WHERE id = ? AND owner_email = ?`
  ).bind(job.status, job.attempt, JSON.stringify(publicPayload), await encryptDistributionSecret(env, privateState), updatedAt, row.id, row.owner_email).run();
  const refreshed = await env.DB.prepare('SELECT * FROM egoric_distribution_jobs WHERE id = ? AND owner_email = ?').bind(row.id, row.owner_email).first();
  const hydrated = hydrateDistributionJob(refreshed);
  const distributionPackage = await syncDistributionPackageFromJobs(env, row.owner_email, row.package_id);
  return { job: hydrated, package: distributionPackage };
}

const failDistributionJob = (job, code, message, retrySafe, status = 'failed') => ({
  ...job, status, errorCode: cleanText(code, 120), error: cleanText(message, 500), retrySafe,
  indeterminateAt: status === 'indeterminate' ? Date.now() : undefined,
});

const parseUploadedRange = (value) => {
  const match = String(value || '').match(/(?:bytes=|bytes\s+0-)(?:0-)?(\d+)$/i);
  return match ? Number(match[1]) + 1 : 0;
};

async function runYoutubeDistributionJob(env, row, job, privateState, connection, reconcile) {
  const token = await getDistributionAccessToken(env, connection);
  if (job.status === 'queued') {
    let response;
    try {
      response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-length': String(job.totalBytes), 'x-upload-content-type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title: cleanText(privateState.title, 100), description: cleanText(privateState.caption, 5000), categoryId: '22' },
          status: { privacyStatus: job.visibility || 'private', embeddable: true, license: 'youtube' },
        }),
      });
    } catch (error) {
      return { job: failDistributionJob(job, 'youtube_init_network', error instanceof Error ? error.message : 'Không thể mở upload session.', true), privateState };
    }
    const payload = response.ok ? {} : await readExternalPayload(response);
    const uploadUrl = response.headers.get('location');
    if (!response.ok || !uploadUrl) {
      return { job: failDistributionJob(job, `youtube_init_${response.status}`, externalErrorMessage(payload, 'YouTube từ chối mở upload session.'), response.status >= 500), privateState };
    }
    return { job: { ...job, status: 'uploading', progress: 0, retrySafe: true, error: undefined, errorCode: undefined }, privateState: { ...privateState, uploadUrl, offset: 0 } };
  }

  if (job.status === 'indeterminate') {
    if (!reconcile || !privateState.uploadUrl) return { job, privateState };
    try {
      const response = await fetch(privateState.uploadUrl, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-length': '0', 'content-range': `bytes */${job.totalBytes}` },
      });
      if (response.status === 308) {
        const offset = parseUploadedRange(response.headers.get('range'));
        return { job: { ...job, status: 'uploading', uploadedBytes: offset, progress: Math.min(99, offset / job.totalBytes * 100), error: undefined, errorCode: undefined, retrySafe: true, indeterminateAt: undefined }, privateState: { ...privateState, offset } };
      }
      if (response.ok) {
        const payload = await readExternalPayload(response);
        return { job: { ...job, status: 'processing', uploadedBytes: job.totalBytes, progress: 100, externalId: payload.id, error: undefined, errorCode: undefined, retrySafe: false, indeterminateAt: undefined }, privateState: { ...privateState, videoId: payload.id } };
      }
      return { job: failDistributionJob(job, `youtube_reconcile_${response.status}`, 'YouTube không xác nhận được vị trí upload.', false, 'indeterminate'), privateState };
    } catch (error) {
      return { job: failDistributionJob(job, 'youtube_reconcile_network', error instanceof Error ? error.message : 'Đối soát YouTube thất bại.', false, 'indeterminate'), privateState };
    }
  }

  if (job.status === 'uploading') {
    const offset = Number(privateState.offset || job.uploadedBytes || 0);
    const length = Math.min(YOUTUBE_CHUNK_BYTES, job.totalBytes - offset);
    const object = await env.MEDIA.get(privateState.mediaKey, { range: { offset, length } });
    if (!object?.body || length <= 0) return { job: failDistributionJob(job, 'master_missing', 'Không đọc được chunk master trên R2.', false), privateState };
    let response;
    try {
      response = await fetch(privateState.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(length),
          'content-range': `bytes ${offset}-${offset + length - 1}/${job.totalBytes}`,
        },
        body: object.body,
      });
    } catch (error) {
      return { job: failDistributionJob(job, 'youtube_upload_unknown', `${error instanceof Error ? error.message : 'Mất kết nối upload.'} Không rõ YouTube đã nhận chunk hay chưa.`, false, 'indeterminate'), privateState };
    }
    if (response.status === 308) {
      const nextOffset = parseUploadedRange(response.headers.get('range')) || offset + length;
      return { job: { ...job, uploadedBytes: nextOffset, progress: Math.min(99, nextOffset / job.totalBytes * 100), retrySafe: true }, privateState: { ...privateState, offset: nextOffset } };
    }
    const payload = await readExternalPayload(response);
    if (response.ok && payload.id) {
      return { job: { ...job, status: 'processing', uploadedBytes: job.totalBytes, progress: 100, externalId: payload.id, retrySafe: false }, privateState: { ...privateState, offset: job.totalBytes, videoId: payload.id } };
    }
    const unknown = response.status >= 500;
    return { job: failDistributionJob(job, `youtube_upload_${response.status}`, externalErrorMessage(payload, 'YouTube từ chối chunk video.'), !unknown, unknown ? 'indeterminate' : 'failed'), privateState };
  }

  if (job.status === 'processing') {
    const videoId = privateState.videoId || job.externalId;
    if (!videoId) return { job: failDistributionJob(job, 'youtube_video_id_missing', 'Thiếu video ID để kiểm tra xử lý.', false, 'indeterminate'), privateState };
    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await readExternalPayload(response);
      if (!response.ok) return { job: failDistributionJob(job, `youtube_status_${response.status}`, externalErrorMessage(payload, 'Không đọc được trạng thái YouTube.'), false, response.status >= 500 ? 'indeterminate' : 'failed'), privateState };
      const status = payload?.items?.[0]?.status?.uploadStatus;
      if (status === 'processed') return { job: { ...job, status: 'published', publishedUrl: `https://www.youtube.com/watch?v=${videoId}`, progress: 100, retrySafe: false, error: undefined, errorCode: undefined }, privateState };
      if (['failed', 'rejected', 'deleted'].includes(status)) return { job: failDistributionJob(job, `youtube_${status}`, payload?.items?.[0]?.status?.rejectionReason || `YouTube báo ${status}.`, true), privateState };
      return { job: { ...job, nextPollAt: Date.now() + 15_000 }, privateState };
    } catch (error) {
      return { job: failDistributionJob(job, 'youtube_status_unknown', error instanceof Error ? error.message : 'Mất kết nối khi kiểm tra YouTube.', false, 'indeterminate'), privateState };
    }
  }
  return { job, privateState };
}

const tiktokChunkPlan = (totalBytes) => totalBytes < 5 * 1024 * 1024
  ? { chunkSize: totalBytes, totalChunkCount: 1 }
  : {
    chunkSize: Math.min(TIKTOK_CHUNK_BYTES, totalBytes),
    totalChunkCount: Math.max(1, Math.floor(totalBytes / Math.min(TIKTOK_CHUNK_BYTES, totalBytes))),
  };

async function fetchTikTokStatus(token, publishId) {
  const response = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const payload = await readExternalPayload(response);
  if (!response.ok || payload?.error?.code !== 'ok') throw new Error(externalErrorMessage(payload, 'TikTok không trả trạng thái hợp lệ.'));
  return payload.data || {};
}

async function runTikTokDistributionJob(env, row, job, privateState, connection, reconcile) {
  const token = await getDistributionAccessToken(env, connection);
  if (job.status === 'queued') {
    const plan = tiktokChunkPlan(job.totalBytes);
    let response;
    try {
      response = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: job.totalBytes, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount } }),
      });
    } catch (error) {
      return { job: failDistributionJob(job, 'tiktok_init_network', error instanceof Error ? error.message : 'Không thể mở upload session TikTok.', true), privateState };
    }
    const payload = await readExternalPayload(response);
    if (!response.ok || payload?.error?.code !== 'ok' || !payload?.data?.upload_url || !payload?.data?.publish_id) {
      return { job: failDistributionJob(job, payload?.error?.code || `tiktok_init_${response.status}`, externalErrorMessage(payload, 'TikTok từ chối mở upload session.'), response.status >= 500), privateState };
    }
    return { job: { ...job, status: 'uploading', progress: 0, retrySafe: true, error: undefined, errorCode: undefined }, privateState: { ...privateState, uploadUrl: payload.data.upload_url, publishId: payload.data.publish_id, offset: 0, chunkSize: plan.chunkSize } };
  }

  if (job.status === 'indeterminate') {
    if (!reconcile || !privateState.publishId) return { job, privateState };
    try {
      const data = await fetchTikTokStatus(token, privateState.publishId);
      const uploadedBytes = Math.min(job.totalBytes, Number(data.uploaded_bytes || 0));
      if (data.status === 'FAILED') return { job: failDistributionJob(job, data.fail_reason || 'tiktok_failed', data.fail_reason || 'TikTok xử lý thất bại.', data.fail_reason === 'internal'), privateState };
      if (data.status === 'SEND_TO_USER_INBOX') return { job: { ...job, status: 'awaiting-user', uploadedBytes: job.totalBytes, progress: 100, error: undefined, errorCode: undefined, retrySafe: false, indeterminateAt: undefined }, privateState };
      if (data.status === 'PUBLISH_COMPLETE') {
        const postId = data.publicaly_available_post_id?.[0];
        return { job: { ...job, status: 'published', uploadedBytes: job.totalBytes, progress: 100, externalId: postId ? String(postId) : privateState.publishId, error: undefined, errorCode: undefined, retrySafe: false, indeterminateAt: undefined }, privateState };
      }
      return { job: { ...job, status: uploadedBytes < job.totalBytes ? 'uploading' : 'processing', uploadedBytes, progress: Math.min(100, uploadedBytes / job.totalBytes * 100), error: undefined, errorCode: undefined, retrySafe: true, indeterminateAt: undefined }, privateState: { ...privateState, offset: uploadedBytes } };
    } catch (error) {
      return { job: failDistributionJob(job, 'tiktok_reconcile_network', error instanceof Error ? error.message : 'Đối soát TikTok thất bại.', false, 'indeterminate'), privateState };
    }
  }

  if (job.status === 'uploading') {
    const offset = Number(privateState.offset || job.uploadedBytes || 0);
    const chunkSize = Number(privateState.chunkSize || TIKTOK_CHUNK_BYTES);
    const remaining = job.totalBytes - offset;
    const length = remaining <= chunkSize * 2 ? remaining : chunkSize;
    const object = await env.MEDIA.get(privateState.mediaKey, { range: { offset, length } });
    if (!object?.body || length <= 0) return { job: failDistributionJob(job, 'master_missing', 'Không đọc được chunk master trên R2.', false), privateState };
    let response;
    try {
      response = await fetch(privateState.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'video/mp4', 'content-length': String(length), 'content-range': `bytes ${offset}-${offset + length - 1}/${job.totalBytes}` },
        body: object.body,
      });
    } catch (error) {
      return { job: failDistributionJob(job, 'tiktok_upload_unknown', `${error instanceof Error ? error.message : 'Mất kết nối upload.'} Không rõ TikTok đã nhận chunk hay chưa.`, false, 'indeterminate'), privateState };
    }
    if (response.status === 206) {
      const nextOffset = offset + length;
      return { job: { ...job, uploadedBytes: nextOffset, progress: Math.min(99, nextOffset / job.totalBytes * 100), retrySafe: true }, privateState: { ...privateState, offset: nextOffset } };
    }
    if (response.status === 201) return { job: { ...job, status: 'processing', uploadedBytes: job.totalBytes, progress: 100, externalId: privateState.publishId, retrySafe: false }, privateState: { ...privateState, offset: job.totalBytes } };
    const payload = await readExternalPayload(response);
    const unknown = response.status >= 500 || response.status === 416;
    return { job: failDistributionJob(job, `tiktok_upload_${response.status}`, externalErrorMessage(payload, 'TikTok từ chối chunk video.'), !unknown, unknown ? 'indeterminate' : 'failed'), privateState };
  }

  if (['processing', 'awaiting-user'].includes(job.status)) {
    try {
      const data = await fetchTikTokStatus(token, privateState.publishId || job.externalId);
      if (data.status === 'FAILED') return { job: failDistributionJob(job, data.fail_reason || 'tiktok_failed', data.fail_reason || 'TikTok xử lý thất bại.', data.fail_reason === 'internal'), privateState };
      if (data.status === 'SEND_TO_USER_INBOX') return { job: { ...job, status: 'awaiting-user', nextPollAt: Date.now() + 30_000, retrySafe: false }, privateState };
      if (data.status === 'PUBLISH_COMPLETE') {
        const postId = data.publicaly_available_post_id?.[0];
        return { job: { ...job, status: 'published', externalId: postId ? String(postId) : (job.externalId || privateState.publishId), progress: 100, retrySafe: false, error: undefined, errorCode: undefined }, privateState };
      }
      return { job: { ...job, status: 'processing', nextPollAt: Date.now() + 15_000 }, privateState };
    } catch (error) {
      return { job: failDistributionJob(job, 'tiktok_status_unknown', error instanceof Error ? error.message : 'Mất kết nối khi kiểm tra TikTok.', false, 'indeterminate'), privateState };
    }
  }
  return { job, privateState };
}

async function queueDistributionJob(request, env, url, email, projectId, body) {
  const packageId = safeDistributionId(body?.packageId, 'distribution');
  const connectionId = safeDistributionId(body?.connectionId, 'connection');
  const platform = safeDistributionPlatform(body?.platform);
  if (!packageId || !connectionId || !platform) return json({ error: 'Package, nền tảng hoặc tài khoản kết nối không hợp lệ.' }, 400);
  if (!DISTRIBUTION_OAUTH_PLATFORMS.has(platform)) return json({ error: 'Adapter này chưa được mở cho upload tự động.' }, 409);
  const [packageRow, projectRow, connection] = await Promise.all([
    env.DB.prepare('SELECT * FROM egoric_distribution_packages WHERE id = ? AND owner_email = ? AND project_id = ?').bind(packageId, email, projectId).first(),
    env.DB.prepare('SELECT payload_json AS payload FROM egoric_projects WHERE owner_email = ? AND project_id = ?').bind(email, projectId).first(),
    env.DB.prepare('SELECT * FROM egoric_distribution_connections WHERE id = ? AND owner_email = ? AND platform = ?').bind(connectionId, email, platform).first(),
  ]);
  if (!packageRow || !projectRow) return json({ error: 'Không tìm thấy package hoặc dự án cloud.' }, 404);
  if (!connection || connection.status !== 'connected') return json({ error: 'Tài khoản nền tảng chưa kết nối hoặc đã hết hạn.' }, 409);
  const distributionPackage = hydrateDistributionPackage(packageRow);
  if (!(distributionPackage.targets || []).some((target) => target.platform === platform)) return json({ error: 'Package không cho phép adapter này.' }, 409);
  let project;
  try { project = JSON.parse(projectRow.payload); } catch { return json({ error: 'Dự án cloud bị lỗi dữ liệu.' }, 500); }
  const master = (project.autoEditor?.outputs || []).find((output) => output?.id === distributionPackage.masterOutputId);
  const mediaPath = getCloudMediaPath(projectId, master?.videoUrl);
  const round = (project.agencyReview?.rounds || []).find((item) => item?.id === distributionPackage.reviewRoundId);
  const gatesApproved = ['director', 'editor', 'account'].every((role) => round?.gates?.find((gate) => gate.role === role)?.status === 'approved');
  if (!master || !mediaPath || master.storage !== 'cloud' || master.status !== 'ready'
    || master.checksum !== distributionPackage.masterChecksum
    || `master:${master.id}:${master.checksum}` !== distributionPackage.artifactSignature
    || !round || !gatesApproved || round.sourceSignature !== reviewSourceSignature(project, round.shotIds || [], master.id)) {
    return json({ error: 'Package đã stale: master hoặc chữ ký nguồn không còn khớp. Hãy tạo vòng duyệt mới.' }, 409);
  }
  const portal = await env.DB.prepare(
    `SELECT decision, decision_version_id, decision_artifact_signature FROM egoric_client_review_portals
     WHERE id = ? AND owner_email = ? AND project_id = ?`
  ).bind(distributionPackage.reviewPortalId, email, projectId).first();
  if (!portal || portal.decision !== 'approved' || portal.decision_version_id !== distributionPackage.reviewVersionId
    || portal.decision_artifact_signature !== distributionPackage.artifactSignature) {
    return json({ error: 'Quyết định khách hàng không còn trùng package.' }, 409);
  }
  const openComment = await env.DB.prepare(
    `SELECT id FROM egoric_client_review_comments WHERE portal_id = ? AND version_id = ? AND status = 'open' LIMIT 1`
  ).bind(distributionPackage.reviewPortalId, distributionPackage.reviewVersionId).first();
  if (openComment) return json({ error: 'Version đã duyệt có góp ý mở; không được xếp hàng.' }, 409);
  const owner = await hashOwner(email);
  const mediaKey = `${owner}/${projectId}/${mediaPath}`;
  const mediaObject = await env.MEDIA.head(mediaKey);
  if (!mediaObject?.size) return json({ error: 'Master không còn tồn tại trên R2.' }, 409);
  const totalBytes = Number(mediaObject.size);
  const visibility = platform === 'youtube' && ['private', 'unlisted', 'public'].includes(body?.visibility) ? body.visibility : platform === 'youtube' ? 'private' : undefined;
  const idempotencyKey = await hashText(JSON.stringify({ packageId, platform, connectionId }));
  const existing = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_jobs WHERE owner_email = ? AND project_id = ? AND idempotency_key = ?'
  ).bind(email, projectId, idempotencyKey).first();
  if (existing) return json({ job: hydrateDistributionJob(existing), package: distributionPackage, duplicate: true });
  const now = Date.now();
  const id = `distributionjob_${crypto.randomUUID()}`;
  const publicPayload = {
    connectionLabel: connection.display_name, visibility, progress: 0, uploadedBytes: 0, totalBytes,
    retrySafe: true, createdAt: now, updatedAt: now,
  };
  const privatePayload = { mediaKey, mediaPath, title: distributionPackage.title, caption: distributionPackage.caption || '', offset: 0 };
  await env.DB.prepare(
    `INSERT INTO egoric_distribution_jobs
      (id, owner_email, project_id, package_id, platform, connection_id, status, idempotency_key, attempt, payload_json, private_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, 1, ?, ?, ?, ?)`
  ).bind(id, email, projectId, packageId, platform, connectionId, idempotencyKey, JSON.stringify(publicPayload), await encryptDistributionSecret(env, privatePayload), now, now).run();
  const created = await env.DB.prepare('SELECT * FROM egoric_distribution_jobs WHERE id = ?').bind(id).first();
  const updatedPackage = await syncDistributionPackageFromJobs(env, email, packageId);
  return json({ job: hydrateDistributionJob(created), package: updatedPackage, duplicate: false }, 201);
}

async function runDistributionJob(env, email, projectId, body) {
  const jobId = safeDistributionId(body?.jobId, 'distributionjob');
  if (!jobId) return json({ error: 'Mã job không hợp lệ.' }, 400);
  const row = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_jobs WHERE id = ? AND owner_email = ? AND project_id = ?'
  ).bind(jobId, email, projectId).first();
  if (!row) return json({ error: 'Không tìm thấy job xuất bản.' }, 404);
  let job = hydrateDistributionJob(row);
  let privateState = {};
  try { privateState = await decryptDistributionSecret(env, row.private_json); } catch { return json({ error: 'Trạng thái upload riêng tư bị lỗi hoặc không giải mã được.' }, 500); }
  if (['published', 'cancelled'].includes(job.status)) return json({ job, package: await syncDistributionPackageFromJobs(env, email, row.package_id) });
  if (job.status === 'indeterminate' && body.action !== 'reconcile') {
    return json({ error: 'Kết quả chưa xác định. Hãy đối soát trước; không được upload lại mù.' }, 409);
  }
  if (job.status === 'failed') {
    if (!job.retrySafe) return json({ error: 'Job không an toàn để retry. Hãy kiểm tra nền tảng trước.' }, 409);
    job = { ...job, status: 'queued', attempt: job.attempt + 1, progress: 0, uploadedBytes: 0, error: undefined, errorCode: undefined };
    privateState = { mediaKey: privateState.mediaKey, mediaPath: privateState.mediaPath, title: privateState.title, caption: privateState.caption, offset: 0 };
  }
  const connection = await env.DB.prepare(
    'SELECT * FROM egoric_distribution_connections WHERE id = ? AND owner_email = ? AND platform = ?'
  ).bind(row.connection_id, email, row.platform).first();
  if (!connection) return json({ error: 'Kết nối của job không còn tồn tại.' }, 409);
  let result;
  try {
    result = row.platform === 'youtube'
      ? await runYoutubeDistributionJob(env, row, job, privateState, connection, body.action === 'reconcile')
      : row.platform === 'tiktok'
        ? await runTikTokDistributionJob(env, row, job, privateState, connection, body.action === 'reconcile')
        : { job: failDistributionJob(job, 'adapter_unavailable', 'Adapter chưa sẵn sàng.', false), privateState };
  } catch (error) {
    result = { job: failDistributionJob(job, 'adapter_runtime_error', error instanceof Error ? error.message : 'Adapter thất bại.', false), privateState };
  }
  return json(await persistDistributionJob(env, row, result.job, result.privateState));
}

async function handleDistributionJobsApi(request, env, url) {
  if (!env.DB || !env.MEDIA) return json({ error: 'Publishing Queue chưa được cấp D1/R2.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập để vận hành hàng đợi.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);
  if (request.method !== 'POST') return json({ error: 'Publishing Queue chỉ nhận POST.' }, 405);
  const body = await request.json();
  if (body?.action === 'queue') return queueDistributionJob(request, env, url, email, projectId, body);
  if (['run', 'reconcile'].includes(body?.action)) return runDistributionJob(env, email, projectId, body);
  return json({ error: 'Hành động Publishing Queue không hợp lệ.' }, 400);
}

const reviewPortalUnavailable = (row) => {
  if (row.status === 'closed') return 'Link duyệt này đã được đóng.';
  if (row.expires_at && Number(row.expires_at) < Date.now()) return 'Link duyệt này đã hết hạn.';
  return null;
};

async function handlePublicClientReviewApi(request, env, url) {
  if (!env.DB || !env.MEDIA) return json({ error: 'Cổng duyệt chưa sẵn sàng.' }, 503);
  const match = url.pathname.match(/^\/api\/client-review\/([^/]+)(?:\/(comments|decision)|\/media\/(.+))?$/);
  if (!match) return json({ error: 'Link duyệt không hợp lệ.' }, 404);
  const token = safeReviewToken(decodeURIComponent(match[1]));
  if (!token) return json({ error: 'Link duyệt không hợp lệ.' }, 404);
  const row = await env.DB.prepare('SELECT * FROM egoric_client_review_portals WHERE token = ?').bind(token).first();
  if (!row) return json({ error: 'Không tìm thấy bản duyệt.' }, 404);
  const unavailable = reviewPortalUnavailable(row);
  if (unavailable) return json({ error: unavailable }, 410);
  const action = match[2];
  const rawMediaPath = match[3];

  if (rawMediaPath && (request.method === 'GET' || request.method === 'HEAD')) {
    const mediaPath = safeMediaPath(rawMediaPath.split('/').map(decodeURIComponent).join('/'));
    if (!mediaPath) return new Response('Not found', { status: 404 });
    let payload = { versions: [] };
    try { payload = JSON.parse(row.payload_json || '{}'); } catch { /* Không cấp quyền nếu payload lỗi. */ }
    const allowed = new Set((payload.versions || []).flatMap((version) => (version.clips || []).flatMap((clip) => [clip.mediaPath, clip.posterPath].filter(Boolean))));
    if (!allowed.has(mediaPath)) return new Response('Not found', { status: 404 });
    const owner = await hashOwner(row.owner_email);
    const object = await env.MEDIA.get(`${owner}/${row.project_id}/${mediaPath}`, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'private, max-age=900');
    let status = 'body' in object ? 200 : 412;
    if ('body' in object && object.range) {
      const offset = Number(object.range.offset || 0);
      const length = Number(object.range.length || object.size);
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set('content-length', String(length));
      status = 206;
    }
    return new Response(request.method === 'HEAD' || !('body' in object) ? null : object.body, { status, headers });
  }

  if (!action && request.method === 'GET') {
    return json({ portal: await loadClientReviewPortal(env, row, request.url) });
  }

  const identity = `public-review:${row.id}:${request.headers.get('cf-connecting-ip') || 'anonymous'}`;
  if (!(await enforceProxyRateLimit(env, identity, action || 'review', 30))) {
    return json({ error: 'Bạn thao tác quá nhanh. Hãy thử lại sau một phút.' }, 429);
  }

  if (action === 'comments' && request.method === 'POST') {
    if (row.decision === 'approved') return json({ error: 'Phiên bản đã nghiệm thu nên không nhận thêm góp ý.' }, 409);
    const body = await request.json();
    let payload = { versions: [] };
    try { payload = JSON.parse(row.payload_json || '{}'); } catch { return json({ error: 'Dữ liệu bản duyệt bị lỗi.' }, 500); }
    const version = (payload.versions || []).find((item) => item.id === body?.versionId);
    const latestVersion = (payload.versions || []).at(-1);
    const clip = version?.clips?.find((item) => item.id === body?.clipId);
    const authorName = cleanText(body?.authorName, 120);
    const authorEmail = cleanText(body?.authorEmail, 180) || null;
    const commentBody = cleanText(body?.body, 2000);
    if (!version || !clip || authorName.length < 2 || !commentBody) return json({ error: 'Hãy nhập tên, nội dung và chọn đúng cảnh cần góp ý.' }, 400);
    if (version.id !== latestVersion?.id) return json({ error: 'Phiên bản cũ đã khóa. Hãy góp ý trên phiên bản mới nhất.' }, 409);
    const timecode = Math.max(0, Math.min(Number(clip.duration) || 0, Number(body?.timecodeSeconds) || 0));
    const id = `client_comment_${crypto.randomUUID()}`;
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO egoric_client_review_comments
        (id, portal_id, version_id, clip_id, author_name, author_email, body, timecode_seconds, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(id, row.id, version.id, clip.id, authorName, authorEmail, commentBody, timecode, now, now).run();
    return json({ comment: { id, versionId: version.id, clipId: clip.id, authorName, authorEmail: authorEmail || undefined, body: commentBody, timecodeSeconds: timecode, status: 'open', createdAt: now, updatedAt: now } }, 201);
  }

  if (action === 'decision' && request.method === 'PUT') {
    if (row.decision === 'approved') return json({ error: 'Bản duyệt này đã được nghiệm thu.' }, 409);
    const body = await request.json();
    const decision = ['approved', 'changes-requested'].includes(body?.decision) ? body.decision : null;
    let payload = { versions: [] };
    try { payload = JSON.parse(row.payload_json || '{}'); } catch { return json({ error: 'Dữ liệu bản duyệt bị lỗi.' }, 500); }
    const versionId = safeReviewId(body?.versionId);
    const version = (payload.versions || []).find((item) => item.id === versionId);
    const latestVersion = (payload.versions || []).at(-1);
    const reviewerName = cleanText(body?.reviewerName, 120);
    const reviewerEmail = cleanText(body?.reviewerEmail, 180) || null;
    const note = cleanText(body?.note, 1000) || null;
    if (!decision || !version || reviewerName.length < 2) return json({ error: 'Hãy nhập tên người duyệt và chọn đúng phiên bản.' }, 400);
    if (version.id !== latestVersion?.id) return json({ error: 'Chỉ phiên bản mới nhất mới được phê duyệt hoặc yêu cầu chỉnh sửa.' }, 409);
    const artifactSignature = cleanText(body?.artifactSignature, 300);
    if (version.artifactSignature && artifactSignature !== version.artifactSignature) {
      return json({ error: 'Artifact đã thay đổi sau khi trang được mở. Hãy tải lại trước khi xác nhận.' }, 409);
    }
    const decisionArtifactSignature = version.artifactSignature || `version:${version.id}`;
    const now = Date.now();
    await env.DB.prepare(
      `UPDATE egoric_client_review_portals SET decision = ?, decision_version_id = ?, decision_artifact_signature = ?, decision_note = ?, reviewer_name = ?, reviewer_email = ?,
        decided_at = ?, updated_at = ? WHERE id = ?`
    ).bind(decision, version.id, decisionArtifactSignature, note, reviewerName, reviewerEmail, now, now, row.id).run();
    const updated = await env.DB.prepare('SELECT * FROM egoric_client_review_portals WHERE id = ?').bind(row.id).first();
    return json({ portal: await loadClientReviewPortal(env, updated, request.url) });
  }

  return json({ error: 'Thao tác review không được hỗ trợ.' }, 405);
}

function createUpstreamRequest(request, url, prefix, origin) {
  const upstreamUrl = new URL(url.pathname.slice(prefix.length) || '/', origin);
  upstreamUrl.search = url.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (ALLOWED_PROXY_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set('origin', origin);
  headers.set('referer', `${origin}/`);

  return new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

async function injectSiteOrigin(response, requestUrl) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const origin = new URL(requestUrl).origin;
  const html = (await response.text()).replaceAll('__EGORIC_ORIGIN__', origin);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const publicReviewLanding = () => new Response(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Egoric Agency · Client Review</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090c;color:#f4f4f5;font-family:Inter,system-ui,sans-serif;padding:24px}.card{width:min(520px,100%);border:1px solid rgba(255,255,255,.1);border-radius:28px;background:rgba(255,255,255,.035);padding:36px;box-shadow:0 28px 80px rgba(0,0,0,.35)}img{width:56px;height:56px;border-radius:16px;object-fit:cover}small{display:block;margin-top:24px;color:#67e8f9;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;line-height:1.15;margin:12px 0;color:#fff}p{color:#a1a1aa;font-size:14px;line-height:1.7;margin:0}.hint{margin-top:22px;padding:14px 16px;border-radius:16px;background:rgba(103,232,249,.07);border:1px solid rgba(103,232,249,.14);color:#cffafe;font-size:12px}a{color:#a5f3fc}</style></head>
<body><main class="card"><img src="/egoric-agency-icon.png" alt="Egoric Agency"><small>Client Review Portal</small><h1>Hãy mở đúng link duyệt từ Egoric.</h1><p>Không gian sản xuất nội bộ được bảo vệ. Khách hàng chỉ có thể xem video và gửi phản hồi bằng link bảo mật do team dự án cung cấp.</p><div class="hint">Nếu link đã hết hạn hoặc bị đóng, hãy liên hệ người phụ trách dự án để nhận link mới.</div></main></body></html>`, {
  status: 403,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

async function serveApp(request, env) {
  const url = new URL(request.url);
  const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
  const legalPath = ['/privacy.html', '/terms.html'].includes(url.pathname);
  if (request.method === 'GET' && acceptsHtml && !legalPath && !url.searchParams.has('review') && !getAuthenticatedEmail(request)) {
    return publicReviewLanding();
  }
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || request.method !== 'GET') {
    return injectSiteOrigin(response, request.url);
  }

  const fallbackUrl = new URL('/index.html', request.url);
  return injectSiteOrigin(await env.ASSETS.fetch(new Request(fallbackUrl, request)), request.url);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/client-review/')) {
      try {
        return await handlePublicClientReviewApi(request, env, url);
      } catch (error) {
        console.error('Public client review API error', error);
        return json({ error: error instanceof Error ? error.message : 'Cổng duyệt khách hàng thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/client-reviews') {
      try {
        return await handleClientReviewsApi(request, env, url);
      } catch (error) {
        console.error('Client reviews API error', error);
        return json({ error: error instanceof Error ? error.message : 'Quản lý cổng duyệt thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/distribution-packages') {
      try {
        return await handleDistributionPackagesApi(request, env, url);
      } catch (error) {
        console.error('Distribution Gateway API error', error);
        return json({ error: error instanceof Error ? error.message : 'Distribution Gateway thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/distribution-oauth/start') {
      try {
        return await handleDistributionOauthStart(request, env, url);
      } catch (error) {
        console.error('Distribution OAuth start error', error);
        return json({ error: error instanceof Error ? error.message : 'Không thể bắt đầu OAuth phân phối.' }, 500);
      }
    }

    if (url.pathname.startsWith('/api/distribution-oauth/callback/')) {
      return handleDistributionOauthCallback(request, env, url);
    }

    if (url.pathname === '/api/distribution-connections') {
      try {
        return await handleDistributionConnectionsApi(request, env, url);
      } catch (error) {
        console.error('Distribution connections error', error);
        return json({ error: error instanceof Error ? error.message : 'Quản lý kết nối phân phối thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/distribution-operations') {
      try {
        return await handleDistributionOperationsApi(request, env, url);
      } catch (error) {
        console.error('Distribution operations error', error);
        return json({ error: error instanceof Error ? error.message : 'Không thể tải Publishing Queue.' }, 500);
      }
    }

    if (url.pathname === '/api/distribution-jobs') {
      try {
        return await handleDistributionJobsApi(request, env, url);
      } catch (error) {
        console.error('Distribution jobs error', error);
        return json({ error: error instanceof Error ? error.message : 'Publishing Queue thất bại.' }, 500);
      }
    }

    if (url.pathname.startsWith('/api/cloud/')) {
      try {
        return await handleCloudApi(request, env, url);
      } catch (error) {
        console.error('Cloud API error', error);
        return json({ error: error instanceof Error ? error.message : 'Cloud API thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/agency-economics') {
      try {
        return await handleAgencyEconomicsApi(request, env);
      } catch (error) {
        console.error('Agency economics API error', error);
        return json({ error: error instanceof Error ? error.message : 'Dashboard tài chính thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/account' || url.pathname.startsWith('/api/account/')) {
      try {
        return await handleAccountApi(request, env, url);
      } catch (error) {
        console.error('Account API error', error);
        return json({ error: error instanceof Error ? error.message : 'Account API thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/jobs') {
      try {
        return await handleJobsApi(request, env, url);
      } catch (error) {
        console.error('Jobs API error', error);
        return json({ error: error instanceof Error ? error.message : 'Jobs API thất bại.' }, 500);
      }
    }

    if (url.pathname === '/api/reviews') {
      try {
        return await handleReviewsApi(request, env, url);
      } catch (error) {
        console.error('Reviews API error', error);
        return json({ error: error instanceof Error ? error.message : 'Reviews API thất bại.' }, 500);
      }
    }

    if (url.pathname.startsWith(TREND_PREFIX)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Feed xu hướng chỉ nhận GET.' }, 405);
      }
      const email = getAuthenticatedEmail(request);
      if (!email) return json({ error: 'Hãy đăng nhập trước khi đọc bảng xu hướng.' }, 401);
      if (!(await enforceProxyRateLimit(env, email, 'trends'))) {
        return json({ error: 'Bạn đang gửi quá nhiều yêu cầu. Hãy chờ một phút rồi thử lại.' }, 429);
      }

      const sourceId = decodeURIComponent(url.pathname.slice(TREND_PREFIX.length));
      const feedUrl = Object.prototype.hasOwnProperty.call(TREND_TARGETS, sourceId)
        ? TREND_TARGETS[sourceId]
        : undefined;
      if (!feedUrl) return json({ error: `Nguồn xu hướng không hợp lệ: ${sourceId}` }, 404);

      try {
        const upstream = await fetch(feedUrl, {
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; EgoricFilmStudio/1.0)',
            accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
        });
        const headers = new Headers();
        headers.set('content-type', upstream.headers.get('content-type') ?? 'application/xml; charset=utf-8');
        headers.set('cache-control', 'no-store');
        headers.set('x-content-type-options', 'nosniff');
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (error) {
        return json({ error: `Không đọc được nguồn ${sourceId}: ${error instanceof Error ? error.message : 'lỗi mạng'}` }, 502);
      }
    }

    const target = Object.entries(API_TARGETS).find(
      ([prefix]) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    );
    if (target) {
      const [prefix, origin] = target;
      if (!ALLOWED_PROXY_METHODS.has(request.method)) return json({ error: 'Phương thức proxy không được hỗ trợ.' }, 405);
      const email = getAuthenticatedEmail(request);
      if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT trước khi gọi nhà cung cấp AI.' }, 401);
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > 30 * 1024 * 1024) return json({ error: 'Yêu cầu API vượt giới hạn 30 MB.' }, 413);
      const bucket = prefix.slice('/api-proxy/'.length).split('/')[0];
      if (!(await enforceProxyRateLimit(env, email, bucket))) {
        return json({ error: 'Bạn đang gửi quá nhiều yêu cầu. Hãy chờ một phút rồi thử lại.' }, 429);
      }
      const response = await fetch(createUpstreamRequest(request, url, prefix, origin));
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return serveApp(request, env);
  },
};
