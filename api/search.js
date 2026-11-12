import { getAdminClient } from './_lib/supabase.js';
import { getUserFromRequest } from './_lib/auth.js';
import { checkSearchLimit } from './_lib/ratelimit.js';
import { embedQuery, embedImage, toVectorLiteral } from './_lib/gemini.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024; // raw request body (Vercel itself rejects bodies over 4.5 MB)
const MAX_Q_CHARS = 1000;
const DEADLINE_MS = 8000;
const RESULT_LIMIT = 20;
const FILTER_KEYS = ['category', 'tag', 'from', 'to']; // the keys private.list_documents filters on (q/page/sort do not apply here)
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg']);

const fail = (res, status, error) => res.status(status).json({ error });

function readBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

function imageLooksValid(mime, buf) {
  if (mime === 'image/png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// Returns { error } or { type:'text', q } or { type:'image', mime, data, filters... } plus filters.
function parse(body) {
  let filters = {};
  if (body.filters != null) {
    if (typeof body.filters !== 'object' || Array.isArray(body.filters)) return { error: 'bad_request' };
    for (const k of FILTER_KEYS) {
      const v = body.filters[k];
      if (typeof v === 'string' && v.trim() && v.length <= 100) filters[k] = v.trim();
    }
  }
  const img = body.image;
  if (img != null) {
    if (typeof img !== 'object' || !IMAGE_MIMES.has(img.mime) || typeof img.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data) || img.data.length < 8) return { error: 'bad_request' };
    const buf = Buffer.from(img.data, 'base64');
    if (!imageLooksValid(img.mime, buf)) return { error: 'bad_request' };
    return { type: 'image', mime: img.mime, data: img.data, filters }; // image wins if q is also sent
  }
  if (typeof body.q !== 'string' && body.q != null) return { error: 'bad_request' };
  const q = (body.q ?? '').trim();
  if (!q || q.length > MAX_Q_CHARS) return { error: 'bad_request' };
  return { type: 'text', q, filters };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'method_not_allowed'); }
  if (Number(req.headers?.['content-length']) > MAX_BODY_BYTES) return fail(res, 413, 'payload_too_large');
  const body = readBody(req);
  if (!body) return fail(res, 400, 'bad_request');
  if (JSON.stringify(body).length > MAX_BODY_BYTES) return fail(res, 413, 'payload_too_large');
  const parsed = parse(body);
  if (parsed.error) return fail(res, 400, parsed.error);

  const limit = checkSearchLimit(req);
  if (!limit.ok) { res.setHeader('Retry-After', limit.reason === 'ip' ? '60' : '3600'); return fail(res, 429, 'rate_limited'); }

  let supabase;
  try { supabase = getAdminClient(); } catch { return fail(res, 503, 'unavailable'); }

  const signal = AbortSignal.timeout(DEADLINE_MS);
  try {
    // One retry only: the whole request has an 8 s budget.
    const embedOpts = { signal, retries: 1, baseDelayMs: 300, timeoutMs: DEADLINE_MS };
    const vec = parsed.type === 'image' ? await embedImage(parsed.mime, parsed.data, embedOpts) : await embedQuery(parsed.q, embedOpts);
    const { data, error } = await supabase.rpc('search_documents_vector', { q: toVectorLiteral(vec), filters: parsed.filters, n: RESULT_LIMIT }).abortSignal(signal);
    if (error || !Array.isArray(data)) throw new Error('search rpc failed');

    // Logging must not fail or delay the response beyond its own errors; it is awaited so the serverless runtime does not freeze it.
    try {
      const user = await getUserFromRequest(supabase, req);
      const sid = req.headers?.['x-session-id'] ?? body.session_id;
      const { error: logError } = await supabase.from('search_logs').insert({
        user_id: user?.id ?? null,
        query_string: parsed.type === 'image' ? '' : parsed.q.slice(0, 300),
        event: 'search', engine: 'vector', query_type: parsed.type,
        results_count: data.length,
        session_id: typeof sid === 'string' ? sid.slice(0, 64) : '',
      });
      if (logError) console.error('search_logs insert failed:', logError.code ?? '');
    } catch { console.error('search_logs insert failed'); }

    return res.status(200).json({ documents: data });
  } catch (err) {
    console.error('vector search unavailable:', err?.name, err?.status ?? '');
    return fail(res, 503, 'unavailable');
  }
}
