// In-memory limiter. LIMITATION: Vercel runs many function instances and recycles them, so these counters are
// per-instance and reset on cold start. The per-IP limit is therefore best-effort and the daily cap is a soft
// ceiling (real total can exceed it by roughly the number of warm instances). For a hard cap, count rows in
// search_logs (engine='vector') or use a shared store such as Upstash/Vercel KV.
const hits = new Map(); // key -> timestamps (ms) inside the window
const daily = { day: '', count: 0 };

const intEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function clientIp(req) {
  const h = req.headers ?? {};
  const first = v => (typeof v === 'string' ? v.split(',')[0].trim() : '');
  return first(h['x-real-ip']) || first(h['x-forwarded-for']) || req.socket?.remoteAddress || '';
}

/** -> { ok:true } | { ok:false, reason:'ip'|'daily' }. Counts only admitted requests toward the daily cap. */
export function checkSearchLimit(req, now = Date.now()) {
  const perMinute = intEnv('SEARCH_RATE_PER_MIN', 20);
  const cap = intEnv('SEARCH_DAILY_CAP', 500);
  const day = new Date(now).toISOString().slice(0, 10);
  if (daily.day !== day) { daily.day = day; daily.count = 0; }
  if (daily.count >= cap) return { ok: false, reason: 'daily' };

  const sid = req.headers?.['x-session-id'];
  const key = clientIp(req) || (typeof sid === 'string' ? sid.slice(0, 64) : '') || 'unknown';
  const recent = (hits.get(key) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= perMinute) { hits.set(key, recent); return { ok: false, reason: 'ip' }; }
  recent.push(now);
  hits.set(key, recent);
  daily.count++;
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  return { ok: true };
}

export function resetRateLimits() { hits.clear(); daily.day = ''; daily.count = 0; }
