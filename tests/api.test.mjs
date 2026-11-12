import { test, expect, beforeEach } from 'bun:test';
import sharp from 'sharp';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// ---- fake supabase (in-memory) ----
function makeDb(seed) {
  const t = { documents: [], search_index_status: [], document_embeddings: [], image_embeddings: [], search_logs: [], profiles: [], ...seed };
  const calls = [];
  const client = {
    tables: t, calls, rpcResult: [], rpcError: null, users: {},
    auth: { getUser: async token => client.users[token] ? { data: { user: client.users[token] }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } } },
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      const r = { abortSignal() { return r; }, then: (a, b) => Promise.resolve({ data: client.rpcError ? null : client.rpcResult, error: client.rpcError }).then(a, b) };
      return r;
    },
    from(table) {
      const rows = t[table]; let op = 'select', payload, filters = [], opts = {}, wantRows = false, single = false;
      const match = r => filters.every(([k, kind, v]) => kind === 'eq' ? r[k] === v : r[k] !== v);
      const b = {
        select(cols) { if (op !== 'select') wantRows = true; return b; },
        insert(p) { op = 'insert'; payload = p; return b; },
        upsert(p, o) { op = 'upsert'; payload = p; opts = o ?? {}; return b; },
        update(p) { op = 'update'; payload = p; return b; },
        delete() { op = 'delete'; return b; },
        eq(k, v) { filters.push([k, 'eq', v]); return b; }, neq(k, v) { filters.push([k, 'neq', v]); return b; },
        maybeSingle() { single = true; return b; },
        then(a, c) {
          calls.push([table, op, payload, filters.map(f => f.join(' '))]);
          let data = null;
          if (op === 'select') { const m = rows.filter(match); data = single ? m[0] ?? null : m; }
          else if (op === 'insert') { rows.push({ ...payload }); }
          else if (op === 'upsert') {
            const keys = (opts.onConflict ?? 'id').split(',');
            const ex = rows.find(r => keys.every(k => r[k] === payload[k]));
            if (ex) { if (!opts.ignoreDuplicates) Object.assign(ex, payload); } else rows.push({ id: crypto.randomUUID(), processed: false, updated_at: 'T0', ...payload });
          } else if (op === 'update') { const m = rows.filter(match); m.forEach(r => Object.assign(r, payload)); data = m.map(r => ({ document_id: r.document_id })); }
          else if (op === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); }
          return Promise.resolve({ data, error: null }).then(a, c);
        },
      };
      return b;
    },
  };
  return client;
}

const vec = Array.from({ length: 768 }, (_, i) => Math.sin(i + 1));
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } }).png().toBuffer();
const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0f0' } }).webp().toBuffer();
const ID = '11111111-1111-4111-8111-111111111111';
let fetchLog;
const realFetch = globalThis.fetch;
function mockFetch(handler) { fetchLog = []; globalThis.fetch = async (url, init) => { fetchLog.push([String(url), init]); return handler(String(url), init); }; }
const geminiOk = () => new Response(JSON.stringify({ embedding: { values: vec } }), { status: 200 });

process.env.GEMINI_API_KEY = 'SECRET-GEMINI-KEY'; process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'SECRET-SRV';
const { embedParts, embedQuery } = await import(`${R}/api/_lib/gemini.js`);
const { indexDocument } = await import(`${R}/api/_lib/indexer.js`);
const rl = await import(`${R}/api/_lib/ratelimit.js`);
const supaMod = await import(`${R}/api/_lib/supabase.js`);
const mkDoc = (o = {}) => ({ id: ID, title: 'Tiêu đề', summary: 'Tóm tắt', content_text: 'Nội dung', cover_url: 'https://img.example.com/a.png', ...o });
beforeEach(() => { rl.resetRateLimits(); globalThis.fetch = realFetch; });

test('gemini: request shape, normalization, retry on 429 then success, key not leaked', async () => {
  let n = 0;
  mockFetch(() => (++n < 3 ? new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }) : geminiOk()));
  const v = await embedParts([{ text: 'x' }], { baseDelayMs: 1 });
  expect(n).toBe(3); expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  const [url, init] = fetchLog[0];
  expect(url).toContain('gemini-embedding-2:embedContent'); expect(init.headers['x-goog-api-key']).toBe('SECRET-GEMINI-KEY');
  expect(JSON.parse(init.body)).toEqual({ content: { parts: [{ text: 'x' }] }, outputDimensionality: 768 });
  mockFetch(() => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }));
  const err = await embedParts([{ text: 'x' }], { baseDelayMs: 1 }).catch(e => e);
  expect(err.status).toBe(400); expect(fetchLog.length).toBe(1); expect(err.message).not.toContain('SECRET');
  mockFetch(() => geminiOk()); await embedQuery('chip', {});
  expect(JSON.parse(fetchLog[0][1].body).content.parts[0].text).toBe('task: search result | query: chip');
});

test('indexer: happy path, webp -> png via sharp, CAS marks processed, idempotent', async () => {
  const db = makeDb({ documents: [mkDoc({ cover_url: 'https://img.example.com/a.webp' })], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1', last_error: 'old' }] });
  const sent = [];
  mockFetch((url, init) => url.includes('img.example.com') ? new Response(webp) : (sent.push(JSON.parse(init.body).content.parts[0]), geminiOk()));
  const r = await indexDocument(db, ID);
  expect(r).toEqual({ ok: true, document_id: ID, indexed: true, image: true });
  expect(sent[0].text).toBe('title: Tiêu đề | text: Tóm tắt\nNội dung');
  expect(sent[1].inlineData.mimeType).toBe('image/png');
  expect(Buffer.from(sent[1].inlineData.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(db.tables.search_index_status[0]).toMatchObject({ processed: true, last_error: null });
  expect(db.tables.document_embeddings.length).toBe(1); expect(db.tables.image_embeddings.length).toBe(1);
  expect(db.tables.document_embeddings[0].embedding.startsWith('[')).toBe(true);
  const r2 = await indexDocument(db, ID); // idempotent; image skipped (already embedded)
  expect(r2.indexed).toBe(true); expect(db.tables.image_embeddings.length).toBe(1);
  expect(fetchLog.filter(([u]) => u.includes('googleapis')).length).toBe(3);
});

test('indexer: cover_url changed removes old image; no cover is still indexed', async () => {
  const db = makeDb({ documents: [mkDoc({ cover_url: 'https://img.example.com/new.png' })], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1' }], image_embeddings: [{ document_id: ID, image_url: 'https://img.example.com/old.png' }] });
  mockFetch(url => url.includes('img.example.com') ? new Response(png) : geminiOk());
  expect((await indexDocument(db, ID)).image).toBe(true);
  expect(db.tables.image_embeddings.map(r => r.image_url)).toEqual(['https://img.example.com/new.png']);
  db.tables.documents[0].cover_url = '';
  const r = await indexDocument(db, ID);
  expect(r).toMatchObject({ ok: true, indexed: true, image: false }); expect(db.tables.image_embeddings.length).toBe(0);
});

test('indexer: edit during indexing -> CAS fails, stays queued', async () => {
  const db = makeDb({ documents: [mkDoc({ cover_url: '' })], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1' }] });
  mockFetch(() => { db.tables.search_index_status[0].updated_at = 'S2'; return geminiOk(); }); // trigger re-queued mid-flight
  const r = await indexDocument(db, ID);
  expect(r).toMatchObject({ ok: true, indexed: false, stale: true });
  expect(db.tables.search_index_status[0].processed).toBe(false);
});

test('indexer: gemini failure and image failure keep processed=false with last_error (no secrets)', async () => {
  const db = makeDb({ documents: [mkDoc()], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1' }] });
  mockFetch(() => new Response(JSON.stringify({ error: { message: 'SECRET-GEMINI-KEY leaked?' } }), { status: 400 }));
  let r = await indexDocument(db, ID);
  expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('SECRET'); expect(db.tables.search_index_status[0].last_error).toContain('Gemini HTTP 400');
  mockFetch(url => url.includes('img.example.com') ? new Response('nope', { status: 404 }) : geminiOk());
  r = await indexDocument(db, ID);
  expect(r.ok).toBe(false); expect(r.error).toContain('image: download HTTP 404');
  expect(db.tables.search_index_status[0]).toMatchObject({ processed: false }); expect(db.tables.search_index_status[0].last_error).toContain('image:');
  const priv = makeDb({ documents: [mkDoc({ cover_url: 'http://127.0.0.1/x.png' })], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1' }] });
  mockFetch(() => geminiOk()); expect((await indexDocument(priv, ID)).error).toContain('private address');
  expect(await indexDocument(db, '22222222-2222-4222-8222-222222222222')).toMatchObject({ ok: false, notFound: true });
});

// ---- handlers ----
function call(handler, { method = 'POST', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); } };
    handler({ method, body, headers }, res);
  });
}
function installDb(db) { globalThis.__db = db; }

test('admin endpoint: 405/401/403/400/200', async () => {
  const db = makeDb({ profiles: [{ id: 'u1', role: 'user' }, { id: 'a1', role: 'admin' }], documents: [mkDoc({ cover_url: '' })], search_index_status: [{ document_id: ID, processed: false, updated_at: 'S1' }] });
  db.users = { tu: { id: 'u1' }, ta: { id: 'a1' } };
  // inject: createClient is cached in supabase.js; monkeypatch via module namespace is impossible, so import handler with mocked module
  const { default: handler } = await importWithDb('/api/admin/index-document.js', db);
  expect((await call(handler, { method: 'GET' })).status).toBe(405);
  expect((await call(handler, { body: { document_id: ID } })).status).toBe(401);
  expect((await call(handler, { body: { document_id: ID }, headers: { authorization: 'Bearer bad' } })).status).toBe(401);
  expect((await call(handler, { body: { document_id: ID }, headers: { authorization: 'Bearer tu' } })).status).toBe(403);
  expect((await call(handler, { body: { document_id: 'nope' }, headers: { authorization: 'Bearer ta' } })).status).toBe(400);
  mockFetch(() => geminiOk());
  const ok = await call(handler, { body: { document_id: ID }, headers: { authorization: 'Bearer ta' } });
  expect(ok).toMatchObject({ status: 200, body: { ok: true, document_id: ID, indexed: true, image: false } });
});

async function importWithDb(path, db) {
  // Bun module mock: replace supabase.js export so handlers get the fake client.
  const { mock } = await import('bun:test');
  mock.module(`${R}/api/_lib/supabase.js`, () => ({ getAdminClient: () => db }));
  return import(`${R}${path}?${Math.random()}`);
}

const PNG_B64 = png.toString('base64');
test('search endpoint: validation, rate limit, success, logging, failures', async () => {
  const db = makeDb({}); db.users = { tu: { id: 'u1' } }; db.rpcResult = [{ id: 'd1', title: 'A' }];
  const { default: handler } = await importWithDb('/api/search.js', db);
  expect((await call(handler, { method: 'GET' })).status).toBe(405);
  for (const body of [{}, { q: '  ' }, { q: 5 }, { q: 'x'.repeat(1001) }, { q: 'a', filters: [] }, { image: { mime: 'image/gif', data: PNG_B64 } }, { image: { mime: 'image/png', data: '!!!' } }, { image: { mime: 'image/jpeg', data: PNG_B64 } }])
    expect(await call(handler, { body })).toMatchObject({ status: 400, body: { error: 'bad_request' } });
  expect((await call(handler, { body: { q: 'a' }, headers: { 'content-length': String(5 * 1024 * 1024) } })).status).toBe(413);

  mockFetch(() => geminiOk());
  const r = await call(handler, { body: { q: 'chip bán dẫn', filters: { category: 'cong-nghe', q: 'evil', page: 3 } }, headers: { authorization: 'Bearer tu', 'x-real-ip': '1.1.1.1', 'x-session-id': 's-1' } });
  expect(r).toMatchObject({ status: 200, body: { documents: [{ id: 'd1', title: 'A' }] } });
  expect(JSON.parse(fetchLog[0][1].body).content.parts[0].text).toBe('task: search result | query: chip bán dẫn');
  const rpc = db.calls.find(c => c[0] === 'rpc'); expect(rpc[1]).toBe('search_documents_vector'); expect(rpc[2].filters).toEqual({ category: 'cong-nghe' }); expect(rpc[2].n).toBe(20); expect(rpc[2].q.startsWith('[')).toBe(true);
  expect(db.tables.search_logs[0]).toMatchObject({ user_id: 'u1', query_string: 'chip bán dẫn', engine: 'vector', query_type: 'text', results_count: 1, event: 'search', session_id: 's-1' });

  const ri = await call(handler, { body: { image: { mime: 'image/png', data: PNG_B64 } }, headers: { 'x-real-ip': '1.1.1.2' } });
  expect(ri.status).toBe(200);
  expect(JSON.parse(fetchLog[1][1].body).content.parts[0].inlineData.mimeType).toBe('image/png');
  expect(db.tables.search_logs[1]).toMatchObject({ user_id: null, query_string: '', query_type: 'image', engine: 'vector' });

  // rate limit per IP (20/min)
  rl.resetRateLimits();
  let last; for (let i = 0; i < 21; i++) last = await call(handler, { body: { q: 'a' }, headers: { 'x-real-ip': '9.9.9.9' } });
  expect(last).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  // daily cap
  rl.resetRateLimits(); process.env.SEARCH_DAILY_CAP = '2';
  await call(handler, { body: { q: 'a' }, headers: { 'x-real-ip': '2.2.2.1' } }); await call(handler, { body: { q: 'a' }, headers: { 'x-real-ip': '2.2.2.2' } });
  expect((await call(handler, { body: { q: 'a' }, headers: { 'x-real-ip': '2.2.2.3' } })).status).toBe(429);
  delete process.env.SEARCH_DAILY_CAP; rl.resetRateLimits();

  // failures -> 503
  mockFetch(() => new Response('{}', { status: 500 }));
  expect(await call(handler, { body: { q: 'a' } })).toMatchObject({ status: 503, body: { error: 'unavailable' } });
  mockFetch(() => geminiOk()); db.rpcError = { message: 'boom' };
  expect(await call(handler, { body: { q: 'a' } })).toMatchObject({ status: 503, body: { error: 'unavailable' } });
  db.rpcError = null;
  // slow gemini -> timeout 503 (shorten via abort: fetch never resolves until aborted)
  mockFetch((u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })))));
  const t0 = Date.now(); const slow = await call(handler, { body: { q: 'a' } });
  expect(slow.status).toBe(503); expect(Date.now() - t0).toBeLessThan(9500);
}, 20000);
