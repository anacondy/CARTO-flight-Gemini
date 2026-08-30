// ─────────────────────────────────────────────────────────────────────────────
// cloudflare-worker.js — self-hostable CORS relay for the Live Flight Radar.
//
// WHY (2026-08-30, incident #4): all three flight-data APIs (adsb.fi, adsb.lol,
// OpenSky) are reachable from browsers but send no Access-Control-Allow-Origin
// header, so no webpage can read them directly. The app therefore falls back to
// public CORS relays (corsproxy.io / allorigins / codetabs) — best-effort and
// shared. This worker is YOUR OWN relay: free (Cloudflare Workers free tier:
// 100k requests/day), private, and allow-listed to exactly the three APIs.
//
// DEPLOY (2 minutes, no credit card):
//   1. Create a free account at https://dash.cloudflare.com (Workers & Pages).
//   2. "Create Worker" → paste this file → Deploy.
//   3. Note the URL, e.g. https://flight-relay.<your-subdomain>.workers.dev
//
// WIRE IT INTO THE APP:
//   1. In index.html set:  PROXY_BASE: 'https://flight-relay.<you>.workers.dev/?url='
//      (inside the CFG object, near the bottom of the tunables block)
//   2. Add the worker host to the CSP connect-src list in index.html, e.g.:
//      connect-src https://flight-relay.<you>.workers.dev ...
//   3. Redeploy / refresh. The engine automatically prefers your relay over the
//      public ones, and only uses it after direct requests fail.
//
// Usage:  https://<worker>/?url=<percent-encoded API URL>
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_HOSTS = new Set([
    'opendata.adsb.fi',     // adsb.fi community API
    'api.adsb.lol',         // adsb.lol community API
    'opensky-network.org'   // OpenSky Network
]);

// Tiny in-memory cache keyed by full URL. Community point queries refresh every
// 12 s per user; caching for 5 s collapses bursts from multiple viewers without
// noticeably staling the radar.
const CACHE_TTL_MS = 5000;
const cache = new Map(); // url → { at, status, ctype, body }

export default {
    async fetch(request) {
        const u = new URL(request.url);

        if (u.pathname === '/ping') {
            return new Response(JSON.stringify({ ok: true, relay: 'flight-radar' }), {
                headers: { 'content-type': 'application/json',
                           'access-control-allow-origin': '*' }
            });
        }

        const target = u.searchParams.get('url');
        if (!target) {
            return new Response('usage: /?url=<encoded https URL of an allowed API>', {
                status: 400,
                headers: { 'access-control-allow-origin': '*' }
            });
        }

        let t;
        try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }

        if (t.protocol !== 'https:' || !ALLOWED_HOSTS.has(t.hostname)) {
            return new Response('host not allowed', {
                status: 403,
                headers: { 'access-control-allow-origin': '*' }
            });
        }

        const hit = cache.get(target);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
            return new Response(hit.body, {
                status: hit.status,
                headers: { 'content-type': hit.ctype,
                           'cache-control': 'no-store',
                           'access-control-allow-origin': '*' }
            });
        }

        const upstream = await fetch(target, {
            headers: { 'accept': 'application/json', 'user-agent': 'flight-radar-relay/1.0' },
            cf: { cacheTtl: 0 }
        });

        const body = await upstream.arrayBuffer();
        const ctype = upstream.headers.get('content-type') || 'application/json';
        if (upstream.ok && cache.size < 500) {
            cache.set(target, { at: Date.now(), status: upstream.status,
                                ctype, body });
        }

        return new Response(body, {
            status: upstream.status,
            headers: { 'content-type': ctype,
                       'cache-control': 'no-store',
                       'access-control-allow-origin': '*' }
        });
    }
};
