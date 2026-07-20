const API_TARGETS = {
  '/api-proxy/openrouter': 'https://openrouter.ai',
  '/api-proxy/google': 'https://generativelanguage.googleapis.com',
  '/api-proxy/replicate': 'https://api.replicate.com',
  '/api-proxy/fpt': 'https://api.fpt.ai',
  '/api-proxy/viettel': 'https://viettelai.vn',
  '/api-proxy/elevenlabs': 'https://api.elevenlabs.io',
};

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const getAuthenticatedEmail = (request) => request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() || null;

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
      await env.DB.prepare('DELETE FROM egoric_projects WHERE owner_email = ? AND project_id = ?').bind(email, projectId).run();
      const owner = await hashOwner(email);
      await deleteMediaPrefix(env.MEDIA, `${owner}/${projectId}/`);
      return json({ deleted: true });
    }
  }

  if (url.pathname === '/api/cloud/media' && request.method === 'PUT') {
    const projectId = safeProjectId(url.searchParams.get('projectId'));
    const mediaPath = safeMediaPath(url.searchParams.get('path'));
    if (!projectId || !mediaPath) return json({ error: 'Đường dẫn media không hợp lệ.' }, 400);
    if (!request.body) return json({ error: 'Không có dữ liệu media.' }, 400);
    const owner = await hashOwner(email);
    const key = `${owner}/${projectId}/${mediaPath}`;
    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
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

  return json({ error: 'Account route không tồn tại.' }, 404);
}

function createUpstreamRequest(request, url, prefix, origin) {
  const upstreamUrl = new URL(url.pathname.slice(prefix.length) || '/', origin);
  upstreamUrl.search = url.search;

  const headers = new Headers(request.headers);
  headers.set('origin', origin);
  headers.set('referer', `${origin}/`);
  headers.delete('host');

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

    const target = Object.entries(API_TARGETS).find(
      ([prefix]) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    );
    if (target) {
      const [prefix, origin] = target;
      return fetch(createUpstreamRequest(request, url, prefix, origin));
    }

    return serveApp(request, env);
  },
};
