// Core indexing logic shared by api/admin/index-document.js and scripts/index-all.mjs.
// One document per call: embed text (+ cover image), upsert vectors, then compare-and-set the queue row.
import { MODEL, embedText, embedImage, toVectorLiteral } from './gemini.js';

const MAX_TEXT_CHARS = 12000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

export const documentPrompt = d =>
  `title: ${d.title} | text: ${[d.summary, d.content_text].filter(Boolean).join('\n')}`.slice(0, MAX_TEXT_CHARS);

const isPng = b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function assertPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('cover_url is not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('cover_url must be http(s)');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '[::1]' || h.startsWith('[f')) {
    throw new Error('cover_url points to a private address');
  }
  return u;
}

async function downloadImage(url) {
  const u = assertPublicHttpUrl(url);
  const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DailyLensIndexer/1.0)' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('downloaded image is empty');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image is larger than 10 MB');
  return buf;
}

// Gemini documents PNG/JPEG only; anything else (webp, gif, avif...) or oversized files go through sharp -> PNG.
async function toGeminiImage(buf) {
  if ((isPng(buf) || isJpeg(buf)) && buf.length <= MAX_INLINE_BYTES) return { mime: isPng(buf) ? 'image/png' : 'image/jpeg', data: buf };
  const { default: sharp } = await import('sharp');
  const png = await sharp(buf).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { mime: 'image/png', data: png };
}

const must = (res, step) => { if (res.error) throw new Error(`${step}: ${res.error.message}`); return res.data; };

export function safeMessage(err) {
  let msg = String(err?.message ?? err ?? 'unknown error');
  for (const name of ['GEMINI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const secret = process.env[name];
    if (secret) msg = msg.split(secret).join('[redacted]');
  }
  return msg.slice(0, 500);
}

/**
 * Index one document. Never throws for per-document problems; returns
 *  { ok:true, document_id, indexed, image, stale? }  or  { ok:false, document_id, error, notFound? }.
 * deps (for tests): { embedText, embedImage, downloadImage, toGeminiImage }. opts.force re-embeds the cover image too.
 */
export async function indexDocument(supabase, documentId, { force = false, deps = {} } = {}) {
  const embT = deps.embedText ?? embedText, embI = deps.embedImage ?? embedImage;
  const download = deps.downloadImage ?? downloadImage, convert = deps.toGeminiImage ?? toGeminiImage;
  const queue = supabase.from('search_index_status');
  let stamp = null; // queue.updated_at at read time: the compare-and-set token
  try {
    // 1. Read the queue stamp BEFORE the document, so any edit after this point changes the stamp and the final CAS fails safe.
    let status = must(await queue.select('updated_at').eq('document_id', documentId).maybeSingle(), 'read queue');
    if (!status) {
      must(await supabase.from('search_index_status').upsert({ document_id: documentId }, { onConflict: 'document_id', ignoreDuplicates: true }), 'create queue row');
      status = must(await supabase.from('search_index_status').select('updated_at').eq('document_id', documentId).maybeSingle(), 'read queue');
    }
    stamp = status?.updated_at ?? null;
    const doc = must(await supabase.from('documents').select('id,title,summary,content_text,cover_url').eq('id', documentId).maybeSingle(), 'read document');
    if (!doc) return { ok: false, document_id: documentId, error: 'not_found', notFound: true };

    // 2. Text embedding.
    const vec = await embT(documentPrompt(doc));
    must(await supabase.from('document_embeddings').upsert({ document_id: documentId, embedding: toVectorLiteral(vec), model: MODEL, updated_at: new Date().toISOString() }, { onConflict: 'document_id' }), 'save document embedding');

    // 3. Cover image (optional). Stale rows for an old cover_url are removed only after the new one is saved.
    const cover = (doc.cover_url ?? '').trim();
    let image = false;
    if (cover) {
      const existing = must(await supabase.from('image_embeddings').select('id').eq('document_id', documentId).eq('image_url', cover), 'read image embeddings');
      if (existing.length && !force) image = true;
      else {
        try {
          const { mime, data } = await convert(await download(cover));
          const ivec = await embI(mime, data.toString('base64'));
          must(await supabase.from('image_embeddings').upsert({ document_id: documentId, image_url: cover, embedding: toVectorLiteral(ivec), model: MODEL, updated_at: new Date().toISOString() }, { onConflict: 'document_id,image_url' }), 'save image embedding');
          image = true;
        } catch (err) { throw new Error(`image: ${safeMessage(err)}`); }
      }
      must(await supabase.from('image_embeddings').delete().eq('document_id', documentId).neq('image_url', cover), 'remove old images');
    } else {
      must(await supabase.from('image_embeddings').delete().eq('document_id', documentId), 'remove old images');
    }

    // 4. Compare-and-set: mark processed only if nobody re-queued the document since we read it.
    const done = must(await supabase.from('search_index_status').update({ processed: true, last_error: null }).eq('document_id', documentId).eq('updated_at', stamp).select('document_id'), 'mark processed');
    if (!done.length) return { ok: true, document_id: documentId, indexed: false, image, stale: true };
    return { ok: true, document_id: documentId, indexed: true, image };
  } catch (err) {
    const message = safeMessage(err);
    try {
      let q = supabase.from('search_index_status').update({ processed: false, last_error: message }).eq('document_id', documentId);
      if (stamp) q = q.eq('updated_at', stamp);
      await q;
    } catch { /* best effort */ }
    return { ok: false, document_id: documentId, error: message };
  }
}
