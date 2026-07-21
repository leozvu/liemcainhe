const API_TARGETS = {
  '/api-proxy/openrouter': 'https://openrouter.ai',
  '/api-proxy/google': 'https://generativelanguage.googleapis.com',
  '/api-proxy/replicate': 'https://api.replicate.com',
  '/api-proxy/kie-files': 'https://kieai.redpandaai.co',
  '/api-proxy/kie': 'https://api.kie.ai',
  '/api-proxy/fpt': 'https://api.fpt.ai',
  '/api-proxy/viettel': 'https://viettelai.vn',
  '/api-proxy/elevenlabs': 'https://api.elevenlabs.io',
};

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
  'x-goog-api-key',
  'api-key',
  'api_key',
  'voice',
  'speed',
  'format',
  'xi-api-key',
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

const safeProjectId = (value) => /^[a-zA-Z0-9_-]{3,120}$/.test(value || '') ? value : null;
const safeReviewId = (value) => /^[a-zA-Z0-9_-]{6,180}$/.test(value || '') ? value : null;
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
    const [profile, projects, usage, events, jobs, media, notes, approvals, clientReviewPortals, clientReviewComments, campaignFinancials] = await Promise.all([
      ensureAccountProfile(request, env, email),
      env.DB.prepare('SELECT project_id AS projectId, title, payload_json AS payloadJson, updated_at AS updatedAt FROM egoric_projects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_usage_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_system_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT project_id, path, content_type, bytes, checksum, etag, created_at, updated_at FROM egoric_media WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 10000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_review_notes WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_stage_approvals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT id, project_id, title, client_name, campaign_name, deliverable_title, status, decision, decision_version_id, decision_note, reviewer_name, reviewer_email, decided_at, expires_at, payload_json, created_at, updated_at FROM egoric_client_review_portals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_client_review_comments WHERE portal_id IN (SELECT id FROM egoric_client_review_portals WHERE owner_email = ?) ORDER BY updated_at DESC LIMIT 10000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_campaign_financials WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 1000').bind(email).all(),
    ]);
    return json({
      product: 'Egoric Film Studio', exportedAt: new Date().toISOString(), profile,
      projects: (projects.results || []).map((project) => ({ ...project, payload: JSON.parse(project.payloadJson), payloadJson: undefined })),
      usage: usage.results || [], events: events.results || [], jobs: jobs.results || [],
      media: media.results || [], reviewNotes: notes.results || [], approvals: approvals.results || [],
      clientReviewPortals: clientReviewPortals.results || [], clientReviewComments: clientReviewComments.results || [],
      campaignFinancials: campaignFinancials.results || [],
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
      env.DB.prepare('DELETE FROM egoric_client_review_portals WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_stage_approvals WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_review_notes WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_media WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_jobs WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_projects WHERE owner_email = ?').bind(email),
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

async function handleJobsApi(request, env, url) {
  if (!env.DB) return json({ error: 'Workspace chưa được cấp cơ sở dữ liệu.' }, 503);
  const email = getAuthenticatedEmail(request);
  if (!email) return json({ error: 'Hãy đăng nhập bằng ChatGPT để dùng hàng đợi bền vững.' }, 401);
  const projectId = safeProjectId(url.searchParams.get('projectId'));
  if (!projectId) return json({ error: 'Mã dự án không hợp lệ.' }, 400);

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT id, kind, stage, label, status, progress, completed_units AS completedUnits,
              total_units AS totalUnits, resource_id AS resourceId, detail, error, attempts,
              created_at AS createdAt, updated_at AS updatedAt
       FROM egoric_jobs WHERE owner_email = ? AND project_id = ?
       ORDER BY updated_at DESC LIMIT 100`
    ).bind(email, projectId).all();
    return json({ jobs: result.results || [] });
  }

  if (request.method === 'PUT') {
    const payload = await request.json();
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs.slice(0, 100) : [];
    if (!jobs.length) return json({ saved: 0 });
    const kinds = new Set(['script-analysis', 'creative-director', 'asset-image', 'keyframe-image', 'video', 'voice', 'cloud-sync', 'export']);
    const stages = new Set(['script', 'assets', 'voice', 'director', 'export']);
    const statuses = new Set(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled']);
    const statements = [];
    for (const job of jobs) {
      if (!/^[a-zA-Z0-9_-]{6,160}$/.test(job?.id || '') || !kinds.has(job?.kind) || !stages.has(job?.stage) || !statuses.has(job?.status)) {
        return json({ error: 'Hàng đợi chứa tác vụ không hợp lệ.' }, 400);
      }
      statements.push(env.DB.prepare(
        `INSERT INTO egoric_jobs
         (id, owner_email, project_id, kind, stage, label, status, progress, completed_units, total_units, resource_id, detail, error, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label, status = excluded.status, progress = excluded.progress,
           completed_units = excluded.completed_units, total_units = excluded.total_units,
           resource_id = excluded.resource_id, detail = excluded.detail, error = excluded.error,
           attempts = excluded.attempts, updated_at = excluded.updated_at
         WHERE egoric_jobs.owner_email = excluded.owner_email AND egoric_jobs.project_id = excluded.project_id`
      ).bind(
        job.id, email, projectId, job.kind, job.stage, String(job.label || 'Tác vụ').slice(0, 240), job.status,
        Math.max(0, Math.min(100, Number(job.progress) || 0)),
        Number.isFinite(Number(job.completedUnits)) ? Math.max(0, Number(job.completedUnits)) : null,
        Number.isFinite(Number(job.totalUnits)) ? Math.max(0, Number(job.totalUnits)) : null,
        String(job.resourceId || '').slice(0, 180) || null,
        String(job.detail || '').slice(0, 1000) || null,
        String(job.error || '').slice(0, 1000) || null,
        Math.max(0, Number(job.attempts) || 0),
        Math.max(0, Number(job.createdAt) || Date.now()),
        Math.min(Date.now(), Math.max(0, Number(job.updatedAt) || Date.now())),
      ));
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

const reviewSourceSignature = (project, shotIds) => {
  const shots = new Map((Array.isArray(project.shots) ? project.shots : []).map((shot) => [shot.id, shot]));
  const payload = {
    shotIds,
    planSignature: project.autoEditor?.planSignature,
    editorSettings: project.autoEditor?.settings,
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
  return {
    id: versionId,
    number,
    label: cleanText(label, 120) || `Phiên bản ${number}`,
    note: cleanText(note, 1000) || undefined,
    duration: clips.reduce((sum, clip) => sum + clip.duration, 0),
    clips,
    internalRoundId: reviewRound.id,
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
    if (!Array.isArray(reviewRound.shotIds) || !reviewRound.shotIds.length || reviewRound.sourceSignature !== reviewSourceSignature(project, reviewRound.shotIds)) {
      return json({ error: 'Media đã thay đổi sau vòng duyệt nội bộ. Hãy mở vòng duyệt mới.' }, 409);
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
          status = 'active', decision = 'pending', decision_version_id = NULL, decision_note = NULL, reviewer_name = NULL, reviewer_email = NULL,
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
        `UPDATE egoric_client_review_portals SET status = 'active', decision = 'pending', decision_version_id = NULL, decision_note = NULL,
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
    const now = Date.now();
    await env.DB.prepare(
      `UPDATE egoric_client_review_portals SET decision = ?, decision_version_id = ?, decision_note = ?, reviewer_name = ?, reviewer_email = ?,
        decided_at = ?, updated_at = ? WHERE id = ?`
    ).bind(decision, version.id, note, reviewerName, reviewerEmail, now, now, row.id).run();
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
