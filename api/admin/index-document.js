import { getAdminClient } from '../_lib/supabase.js';
import { requireAdmin } from '../_lib/auth.js';
import { indexDocument } from '../_lib/indexer.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  let supabase;
  try { supabase = getAdminClient(); } catch { return res.status(503).json({ ok: false, error: 'unavailable' }); }
  try {
    const auth = await requireAdmin(supabase, req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const body = readBody(req);
    if (!body || typeof body.document_id !== 'string' || !UUID.test(body.document_id)) return res.status(400).json({ ok: false, error: 'bad_request' });
    const result = await indexDocument(supabase, body.document_id, { force: body.force === true });
    if (result.ok) return res.status(200).json(result);
    return res.status(result.notFound ? 404 : 502).json({ ok: false, error: result.error });
  } catch (err) {
    console.error('index-document failed:', err?.message);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
