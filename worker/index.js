const API_PREFIX = '/api-proxy';
const API_ORIGIN = 'https://api.gitcc.com';

function createUpstreamRequest(request, url) {
  const upstreamUrl = new URL(url.pathname.slice(API_PREFIX.length) || '/', API_ORIGIN);
  upstreamUrl.search = url.search;

  const headers = new Headers(request.headers);
  headers.set('origin', API_ORIGIN);
  headers.set('referer', `${API_ORIGIN}/`);
  headers.delete('host');

  return new Request(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

async function serveApp(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || request.method !== 'GET') {
    return response;
  }

  const fallbackUrl = new URL('/index.html', request.url);
  return env.ASSETS.fetch(new Request(fallbackUrl, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      return fetch(createUpstreamRequest(request, url));
    }

    return serveApp(request, env);
  },
};
