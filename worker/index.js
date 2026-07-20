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
