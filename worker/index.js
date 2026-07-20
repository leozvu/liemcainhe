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

async function enforceProxyRateLimit(env, email, bucket) {
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
  return Number(row?.requestCount || 1) <= 180;
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
const safeMediaPath = (value) => {
  const decoded = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!decoded || decoded.includes('..') || decoded.length > 500) return null;
  return decoded.split('/').map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_')).filter(Boolean).join('/');
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
      `SELECT id, project_id AS projectId, kind, provider_id AS providerId, model_id AS modelId,
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
       (id, owner_email, project_id, kind, provider_id, model_id, units, estimated_cost_usd, duration_ms, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, email, safeProjectId(payload.projectId), kind,
      String(payload.providerId || '').slice(0, 120) || null,
      String(payload.modelId || '').slice(0, 200) || null,
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
    const [profile, projects, usage, events, jobs, media, notes, approvals] = await Promise.all([
      ensureAccountProfile(request, env, email),
      env.DB.prepare('SELECT project_id AS projectId, title, payload_json AS payloadJson, updated_at AS updatedAt FROM egoric_projects WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_usage_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_system_events WHERE owner_email = ? ORDER BY created_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_jobs WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT project_id, path, content_type, bytes, checksum, etag, created_at, updated_at FROM egoric_media WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 10000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_review_notes WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
      env.DB.prepare('SELECT * FROM egoric_stage_approvals WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 5000').bind(email).all(),
    ]);
    return json({
      product: 'Egoric Film Studio', exportedAt: new Date().toISOString(), profile,
      projects: (projects.results || []).map((project) => ({ ...project, payload: JSON.parse(project.payloadJson), payloadJson: undefined })),
      usage: usage.results || [], events: events.results || [], jobs: jobs.results || [],
      media: media.results || [], reviewNotes: notes.results || [], approvals: approvals.results || [],
    });
  }

  if (url.pathname === '/api/account/data' && request.method === 'DELETE') {
    if (request.headers.get('x-egoric-confirm') !== 'DELETE_ACCOUNT_DATA') {
      return json({ error: 'Thiếu xác nhận xóa dữ liệu.' }, 400);
    }
    const owner = await hashOwner(email);
    await deleteMediaPrefix(env.MEDIA, `${owner}/`);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM egoric_stage_approvals WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_review_notes WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_media WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_jobs WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_projects WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_usage_events WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_system_events WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_profiles WHERE owner_email = ?').bind(email),
      env.DB.prepare('DELETE FROM egoric_rate_limits WHERE owner_email = ?').bind(email),
    ]);
    return json({ deleted: true });
  }

  return json({ error: 'Account route không tồn tại.' }, 404);
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
    const kinds = new Set(['script-analysis', 'asset-image', 'keyframe-image', 'video', 'voice', 'cloud-sync', 'export']);
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

async function serveApp(request, env) {
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

    if (url.pathname.startsWith('/api/cloud/')) {
      try {
        return await handleCloudApi(request, env, url);
      } catch (error) {
        console.error('Cloud API error', error);
        return json({ error: error instanceof Error ? error.message : 'Cloud API thất bại.' }, 500);
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
