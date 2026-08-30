// ─────────────────────────────────────────────────────────────────────────────
// app.test.mjs — dependency-free test suite for the single-file flight radar.
//
// What it covers:
//   1. Syntax check of the whole inline <script> (catches wiring typos).
//   2. Unit tests of the PURE-LOGIC block extracted straight out of index.html
//      (dead reckoning, source normalisation, OpenSky credit maths, URL building,
//      angle/longitude helpers). Fixtures are REAL payloads captured from the
//      live OpenSky and adsb.lol APIs on 2026-08-30.
//   3. "Wiring" assertions: CSP allows both data sources, SRI hashes present,
//      Leaflet pinned, required UI elements exist.
//
// Run with:  node test/app.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
function ok(cond, name) {
    if (cond) { passed++; console.log(`  ✔ ${name}`); }
    else      { failed++; console.error(`  ✘ ${name}`); }
}
function approx(a, b, tol, name) {
    ok(Math.abs(a - b) <= tol, `${name} (${a.toFixed(6)} ≈ ${b})`);
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name}: ${JSON.stringify(a)} === ${JSON.stringify(b)}`); }

// ── 1. Extract the app script and syntax-check it ───────────────────────────
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
ok(!!scriptMatch, 'inline <script> block found before </body>');
if (scriptMatch) {
    try { new Function(scriptMatch[1]); ok(true, 'inline script parses (syntax OK)'); }
    catch (e) { ok(false, `inline script parses (syntax OK) — ${e.message}`); }
}

// ── 2. Extract + evaluate the PURE-LOGIC block ───────────────────────────────
const pureMatch = html.match(/PURE-LOGIC-START([\s\S]*?)PURE-LOGIC-END/);
ok(!!pureMatch, 'PURE-LOGIC block found in index.html');

const lib = pureMatch
    ? new Function(`
        ${pureMatch[1]}
        return { num, normLon, shortestAngle, haversineNm, deadReckon, predictPos,
                 estimateOpenSkyCredits, buildOpenSkyQuery, buildAdsbUrl,
                 buildProxiedUrl, normalizeOpenSky, normalizeAdsb, ADSB_SOURCES };
      `)()
    : null;

if (!lib) {
    console.error('\nFATAL: could not load pure-logic block — aborting.');
    process.exit(1);
}

console.log('\n── helpers ──');
eq(lib.normLon(190), -170, 'normLon wraps >180');
eq(lib.normLon(-190), 170, 'normLon wraps <-180');
approx(lib.normLon(77.1), 77.1, 1e-9, 'normLon keeps in-range values');
approx(lib.shortestAngle(350, 10), 370, 1e-9, 'shortestAngle 350→10 goes +20 via north');
approx(lib.shortestAngle(10, 350), -10, 1e-9, 'shortestAngle 10→350 goes −20 via north');
approx(lib.shortestAngle(100, 100), 100, 1e-9, 'shortestAngle no-op');
approx(lib.shortestAngle(0, 180), 180, 1e-9, 'shortestAngle antipode');
ok(lib.num('12.5') === 12.5 && lib.num('abc') === null && lib.num(null) === null,
   'num() coerces safely and rejects garbage');
approx(lib.haversineNm(28, 77, 29, 77), 60, 0.5, 'haversineNm: 1° latitude ≈ 60 nm');
approx(lib.haversineNm(28, 77, 28, 78), 60 * Math.cos(28 * Math.PI / 180), 0.5,
       'haversineNm: 1° longitude shrinks with cos(lat)');

console.log('\n── dead reckoning ──');
const north = lib.deadReckon(0, 0, 0, 100, 1);
approx(north[0], 100 / 111320, 1e-9, 'DR due north moves lat by v·dt/111320');
approx(north[1], 0, 1e-12, 'DR due north leaves lon unchanged');
const east0 = lib.deadReckon(0, 0, 90, 100, 1);
approx(east0[1], 100 / 111320, 1e-9, 'DR due east at equator moves lon by v·dt/111320');
const east60 = lib.deadReckon(60, 0, 90, 100, 1);
approx(east60[1], 100 / (111320 * Math.cos(60 * Math.PI / 180)), 1e-9,
       'DR due east at 60°N doubles lon per metre');
eq(lib.deadReckon(10, 20, 123, 0, 60), [10, 20], 'DR with zero velocity is a no-op');
eq(lib.deadReckon(10, 20, 123, 100, -5), [10, 20], 'DR with negative dt is a no-op');
const crossed = lib.deadReckon(0, 179.9, 90, 100, 3600); // 1h east at 100 m/s
ok(crossed[1] < 180 && crossed[1] > -180, 'DR wraps longitude across the antimeridian');

// predictPos: fresh fix → unchanged; 10 s-old fix advanced accordingly.
const model = { lat: 10, lon: 20, track: 0, vel: 100, fixMs: 100000 };
eq(lib.predictPos(model, 100000, 120000), [10, 20], 'predictPos: zero age returns fix');
const p10 = lib.predictPos(model, 110000, 120000);
approx(p10[0], 10 + 1000 / 111320, 1e-9, 'predictPos: advances 10 s × 100 m/s north');
const pStale = lib.predictPos(model, 100000 + 10 * 60 * 1000, 120000); // 10 min stale, 2 min cap
approx(pStale[0], 10 + (120 * 100) / 111320, 1e-9, 'predictPos: extrapolation capped at maxAge');

console.log('\n── OpenSky credit & query maths ──');
eq(lib.estimateOpenSkyCredits(9), 1, 'credits: ≤25 sq° → 1');
eq(lib.estimateOpenSkyCredits(25), 1, 'credits: 25 sq° boundary → 1');
eq(lib.estimateOpenSkyCredits(26), 2, 'credits: 26 sq° → 2');
eq(lib.estimateOpenSkyCredits(100), 2, 'credits: 100 sq° boundary → 2');
eq(lib.estimateOpenSkyCredits(101), 3, 'credits: 101 sq° → 3');
eq(lib.estimateOpenSkyCredits(400), 3, 'credits: 400 sq° boundary → 3');
eq(lib.estimateOpenSkyCredits(401), 4, 'credits: >400 sq° → 4');
eq(lib.estimateOpenSkyCredits(64800), 4, 'credits: whole world (180×360) → 4');

const q = lib.buildOpenSkyQuery(28, 76, 31, 79); // Delhi box (3°×3° = 9 sq°)
ok(q.url.includes('lamin=28.0000') && q.url.includes('lomin=76.0000') &&
   q.url.includes('lamax=31.0000') && q.url.includes('lomax=79.0000'),
   'OpenSky query encodes the viewport bbox');
eq(q.credits, 1, 'Delhi-sized viewport costs 1 credit');
const qdl = lib.buildOpenSkyQuery(10, 170, 30, -170); // crosses the dateline
ok(qdl.url.includes('lomin=-180.0000') && qdl.url.includes('lomax=180.0000'),
   'dateline-crossing view degrades to a world query');
eq(qdl.credits, 4, 'world query costs 4 credits');
const qclamp = lib.buildOpenSkyQuery(-95, -10, 95, 10);
ok(qclamp.url.includes('lamin=-85.0000') && qclamp.url.includes('lamax=85.0000'),
   'latitudes clamped to ±85 (Web-Mercator limit)');

console.log('\n── community ADS-B URL builders (fan-out sources) ──');
// [CHANGED 2026-08-30 — incident #3] two keyless ADSB-X endpoints are tried in
// order, so a network that blocks one falls through to the other.
eq(lib.ADSB_SOURCES.length, 2, 'two community ADS-B sources configured');
ok(lib.ADSB_SOURCES[0].base === 'https://opendata.adsb.fi/api' &&
   lib.ADSB_SOURCES[1].base === 'https://api.adsb.lol/v2',
   'fan-out order: adsb.fi first, adsb.lol second');
ok(lib.buildAdsbUrl(0, 28.6, 77.1, 250) ===
   'https://opendata.adsb.fi/api/v3/lat/28.6000/lon/77.1000/dist/250',
   'adsb.fi v3 URL well-formed');
ok(lib.buildAdsbUrl(1, 28.6, 77.1, 250) ===
   'https://api.adsb.lol/v2/lat/28.6000/lon/77.1000/dist/250',
   'adsb.lol v2 URL well-formed');
ok(lib.buildAdsbUrl(1, 0, 190, 300).includes('/lon/-170.0000/dist/250'),
   'URL wraps lon and clamps radius to 250 nm');
ok(lib.buildAdsbUrl(99, 10, 20, 100).startsWith('https://api.adsb.lol/v2/'),
   'out-of-range source index clamps to the last entry');

console.log('\n── OpenSky normalisation (live fixture, 2026-08-30) ──');
// Real rows captured from GET /api/states/all?lamin=28&lomin=76&lamax=31&lomax=79
const openskyFixture = [
    ["80161d","AKJ301N ","India",1788109526,1788109527,77.0002,28.587,1013.46,false,121.53,284.21,10.73,null,937.26,null,false,0],
    ["80174a","IGO413V ","India",1788109523,1788109523,77.1051,28.5642,null,true,13.38,106.88,null,null,null,null,false,0],   // on ground → dropped
    ["00b22c","","South Africa",null,1788109492,null,null,null,false,265.35,110.54,0,null,null,null,false,0],                  // no position → dropped
    ["80172c","IGO1014 ","India",1788109526,1788109526,77.2758,28.3628,1600.2,false,128.75,10.59,-4.23,null,1577.34,null,false,0]
];
const NOW = 1788109600000; // fixed epoch ms so assertions are deterministic
const osModels = lib.normalizeOpenSky(openskyFixture, NOW);
eq(osModels.length, 2, 'ground + positionless aircraft filtered out');
eq(osModels[0].id, '80161d', 'id from icao24');
eq(osModels[0].callsign, 'AKJ301N', 'callsign trimmed');
eq(osModels[0].country, 'India', 'origin country mapped');
approx(osModels[0].altM, 937.26, 1e-6, 'geo altitude preferred (idx 13)');
approx(osModels[1].altM, 1577.34, 1e-6, 'falls back to geo even when baro present');
approx(osModels[0].vel, 121.53, 1e-6, 'velocity in m/s');
approx(osModels[0].track, 284.21, 1e-6, 'true track mapped');
// fix age = now − time_position, clamped to 60 s: 1788109600 − 1788109526 = 74 → 60
eq(osModels[0].fixMs, NOW - 60000, 'fixMs uses time_position age, clamped to 60 s');
eq(osModels[0].source, 'opensky', 'source tagged');
// baro-only fallback row (geo null): craft one
const baroOnly = [["abc123","TEST1  ","Testland",1788109590,1788109590,10,20,1500,false,50,90,0,null,null,null,false,0]];
approx(lib.normalizeOpenSky(baroOnly, NOW)[0].altM, 1500, 1e-6,
       'altitude falls back to barometric when geo is null');

console.log('\n── community ADS-B normalisation (live fixtures, 2026-08-30) ──');
// Real rows captured from the live APIs today: adsb.lol /v2 point query and
// adsb.fi /v3 point query (identical ADSB-X schema).
const adsbFixture = [
    { hex:"8013ed", flight:"AIC314  ", r:"VT-TVB", t:"A21N", alt_baro:11425, gs:358.6,
      track:119.21, lat:28.419937, lon:77.003913, seen_pos:0.65 },
    { hex:"801741", flight:"IGO6636 ", r:"VT-ICG", t:"A21N", alt_baro:3550,
      calc_track:298, lat:28.574788, lon:77.311545, seen_pos:49.589 },      // no gs/track
    { hex:"deadbe", flight:"GROUND1 ", r:"N/A", t:"C172", alt_baro:"ground", gs:0,
      track:360, lat:28.5, lon:77.1, seen_pos:1 },                          // ground → dropped
    { hex:"cafe00", flight:"NOPOS   ", r:"", t:"", alt_baro:5000, gs:200,
      track:10, lat:null, lon:null, seen_pos:2 },                           // no position → dropped
    // adsb.fi v3 row (richer: desc/ownOp) — captured from opendata.adsb.fi
    { hex:"8015f7", flight:"AIC101  ", r:"VT-JRA", desc:"AIRBUS A-350-900",
      alt_baro:9375, gs:375.5, track:213.27, lat:28.215179, lon:76.829453, seen_pos:0.306 }
];
const adModels = lib.normalizeAdsb(adsbFixture, NOW);
eq(adModels.length, 3, 'ground + positionless aircraft filtered out');
eq(adModels[0].id, '8013ed', 'id from hex');
eq(adModels[0].callsign, 'AIC314', 'callsign trimmed');
approx(adModels[0].altM, 11425 * 0.3048, 1e-3, 'altitude converted ft → m (mm precision)');
approx(adModels[0].vel, 358.6 * 0.514444, 1e-6, 'ground speed converted kt → m/s');
approx(adModels[0].track, 119.21, 1e-6, 'track mapped');
eq(adModels[0].reg, 'VT-TVB', 'registration preserved');
eq(adModels[0].actype, 'A21N', 'aircraft type preserved');
eq(adModels[0].fixMs, NOW - 650, 'fixMs uses seen_pos age');
approx(adModels[1].vel, 0, 1e-9, 'missing gs tolerated as 0 m/s');
approx(adModels[1].track, 298, 1e-6, 'calc_track used when track missing');
eq(adModels[2].actype, 'AIRBUS A-350-900',
   'adsb.fi rows: desc used as type when t is missing');

console.log('\n── wiring & security assertions ──');
ok(html.includes('connect-src https://opensky-network.org https://api.adsb.lol'),
   'CSP connect-src allows both live data sources');
ok(html.includes("L.map('map'"), 'map initialised on #map');
ok(html.includes('basemaps.cartocdn.com/dark_all'), 'CARTO Dark Matter tiles wired');
ok(html.includes("id=\"status\""), 'status HUD element present');
ok(html.includes('escapeHtml'), 'HTML escaping present for API data');
ok(!/setInterval\(\s*fetch/.test(scriptMatch ? scriptMatch[1] : ''),
   'fetch loop is self-scheduling (no blind setInterval → no overlapping requests)');
ok(scriptMatch && scriptMatch[1].includes('visibilitychange'),
   'pauses polling when the tab is hidden');

console.log('\n── resilience (2026-08-30 incidents #2 & #3) ──');
// Leaflet must be self-hosted: the unpkg CDN dependency made the whole map vanish
// for users whose network cannot reach unpkg.com.
ok(html.includes('src="vendor/leaflet/leaflet.js"'), 'Leaflet is self-hosted (vendor/)');
ok(!html.includes('unpkg.com/leaflet'), 'no unpkg Leaflet dependency remains');
ok(html.includes('href="vendor/leaflet/leaflet.css"'), 'Leaflet CSS self-hosted (vendor/)');
{
    const exists = p => { try { readFileSync(join(ROOT, p)); return true; } catch { return false; } };
    ok(exists('vendor/leaflet/leaflet.js') && exists('vendor/leaflet/leaflet.css') &&
       exists('vendor/leaflet/LICENSE'), 'vendored Leaflet files exist (incl. BSD LICENSE)');
    // The SRI hash in the HTML must match the actual vendored file — proves the
    // file wasn't corrupted and protects against future tampering.
    const crypto = await import('node:crypto');
    const sri = f => 'sha256-' + crypto.createHash('sha256')
        .update(readFileSync(join(ROOT, f))).digest('base64');
    const jsAttr = html.match(/src="vendor\/leaflet\/leaflet\.js"\s+integrity="([^"]+)"/);
    const cssAttr = html.match(/href="vendor\/leaflet\/leaflet\.css"\s+integrity="([^"]+)"/);
    ok(!!jsAttr && jsAttr[1] === sri('vendor/leaflet/leaflet.js'),
       'SRI hash in HTML matches vendored leaflet.js');
    ok(!!cssAttr && cssAttr[1] === sri('vendor/leaflet/leaflet.css'),
       'SRI hash in HTML matches vendored leaflet.css');
    ok(sri('vendor/leaflet/leaflet.css') === 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
       'vendored CSS is byte-identical to the official Leaflet 1.9.4 CDN build');
}
ok(scriptMatch && scriptMatch[1].includes("typeof L === 'undefined'"),
   'boot guard: visible HUD error if the map engine fails to load');
ok(scriptMatch && scriptMatch[1].includes('tileerror') &&
   html.includes('tile.openstreetmap.org'),
   'basemap fallback to OpenStreetMap on primary tile failure');
ok(html.includes('img-src data: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://tile.openstreetmap.org https://*.arcgisonline.com'),
   'CSP img-src allows all three basemap hosts');
ok(html.includes('.osm-dark-filter'), 'dark-mode CSS tint exists for fallback tiles');
ok(html.includes('vendor/leaflet/leaflet.js') && html.split('https://unpkg.com').length === 1,
   'index.html has no remaining unpkg references (diag page excluded)');

console.log('\n── incident #3: watermark-free basemap + source fan-out ──');
// CARTO raster tiles now carry an "API key required" watermark for keyless use,
// so the default basemap must be Esri's key-free World Dark Gray canvas.
ok(html.includes('Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'),
   'default basemap is Esri World Dark Gray (no key, no watermark)');
ok(html.includes('Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'),
   'Esri reference overlay (labels/borders) wired');
ok(html.includes('CARTO_KEY') && html.includes("CARTO_KEY: ''"),
   'CARTO Dark Matter remains available as opt-in via CONFIG.CARTO_KEY');
ok(scriptMatch && scriptMatch[1].includes('if (CFG.CARTO_KEY)'),
   'CARTO layer only used when a key is configured');
// Data fan-out: three keyless endpoints, ordered, with per-endpoint health.
ok(html.includes('connect-src https://opensky-network.org https://api.adsb.lol https://opendata.adsb.fi https://corsproxy.io https://api.allorigins.win https://api.codetabs.com'),
   'CSP connect-src allows all three live data sources + the three CORS relays');
ok(scriptMatch && scriptMatch[1].includes("adsbfi: 0, adsblol: 0, opensky: 0"),
   'per-endpoint health tracking for all three sources');
ok(scriptMatch && scriptMatch[1].includes('buildCandidateList(plan)'),
   'refresh walks a multi-route candidate chain (direct + relays)');
// Regression: diag.html must permit loading the vendored script — its CSP once
// forgot 'self' in script-src, making check 1 report a false failure.
{
    const diag = readFileSync(join(ROOT, 'diag.html'), 'utf8');
    ok(/script-src[^;']*'self'/.test(diag),
       "diag.html CSP allows 'self' scripts (check-1 false-fail regression)");
    ok(diag.includes('opendata.adsb.fi'),
       'diag.html tests the adsb.fi endpoint too');
}

console.log('\n── incident #4: CORS-relay tier ──');
// All three flight APIs are reachable but send no Access-Control-Allow-Origin,
// so the engine retries each source through read-only CORS relays.
ok(lib.buildProxiedUrl('https://r.example/?url={url}', 'https://api.adsb.lol/v2/x') ===
   'https://r.example/?url=' + encodeURIComponent('https://api.adsb.lol/v2/x'),
   'buildProxiedUrl percent-encodes the inner API URL');
ok(html.includes('https://corsproxy.io/?url={url}') &&
   html.includes('https://api.allorigins.win/raw?url={url}') &&
   html.includes('https://api.codetabs.com/v1/proxy?quest={url}'),
   'three public relay templates configured');
ok(html.includes("PROXY_BASE: ''"),
   'self-hosted relay override (PROXY_BASE) present, default off');
ok(scriptMatch && scriptMatch[1].includes('proxyFails') &&
   scriptMatch[1].includes('bestRoute'),
   'per-relay health tracking + sticky winning route');
ok(scriptMatch && scriptMatch[1].includes('plan.openskyCredits <= 2'),
   'OpenSky goes through relays for small boxes only (never world queries)');
{
    const exists = p => { try { readFileSync(join(ROOT, p)); return true; } catch { return false; } };
    ok(exists('extras/cloudflare-worker.js'), 'self-hostable Cloudflare Worker relay provided');
    const worker = readFileSync(join(ROOT, 'extras/cloudflare-worker.js'), 'utf8');
    ok(worker.includes("'access-control-allow-origin': '*'") &&
       worker.includes('ALLOWED_HOSTS'), 'worker sends CORS headers + allow-lists the APIs');
    const diag = readFileSync(join(ROOT, 'diag.html'), 'utf8');
    ok(diag.includes('corsproxy.io') && diag.includes('allorigins') && diag.includes('codetabs'),
       'diag.html tests all three relay routes from the user\'s browser');
}

console.log(`\n\u2550\u2550 ${passed} passed, ${failed} failed \u2550\u2550`);
process.exit(failed ? 1 : 0);
