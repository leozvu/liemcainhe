const API_TARGETS = {
  '/api-proxy/openrouter': 'https://openrouter.ai',
  '/api-proxy/google': 'https://generativelanguage.googleapis.com',
  '/api-proxy/replicate': 'https://api.replicate.com',
};

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
