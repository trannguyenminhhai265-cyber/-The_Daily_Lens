// Phase 0 probe: gemini-embedding-2 on the Daily Lens seed data. Never prints the API key.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [envPath, seedPath, outDir] = process.argv.slice(2);
const key = readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY='))?.slice(15).trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('no key');
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
mkdirSync(`${outDir}/imgs`, { recursive: true });
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
let lastShape = null;

async function embed(parts) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const t0 = Date.now();
    const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ content: { parts }, outputDimensionality: 768 }) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const values = body.embedding?.values ?? body.embeddings?.[0]?.values;
      if (!values) { lastShape = Object.keys(body); throw new Error('unexpected response keys: ' + lastShape); }
      return { v: norm(values), ms: Date.now() - t0 };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`HTTP ${res.status}: ${body.error?.message?.slice(0, 200) ?? JSON.stringify(body).slice(0, 200)}`);
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

// ---- documents (cached) ----
const docText = a => `${a.summary ?? ''}\n${(a.paragraphs ?? []).join('\n')}`.trim();
const docPrompt = a => `title: ${a.title} | text: ${docText(a)}`;
const cachePath = `${outDir}/doc_vectors.json`;
let docVecs = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : null;
if (!docVecs) {
  console.log('embedding 90 documents...');
  docVecs = await pool(seed, 4, async a => (await embed([{ text: docPrompt(a) }])).v);
  writeFileSync(cachePath, JSON.stringify(docVecs));
}

// ---- keyword baseline: same rule as private.list_documents (every term is a substring) ----
const hay = seed.map(a => `${a.title} ${a.summary ?? ''} ${(a.paragraphs ?? []).join(' ')}`.toLowerCase());
const keyword = q => seed.map((_, i) => i).filter(i => q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay[i].includes(t)));

// ---- text -> document queries ----
const Q = [
  ['chip bán dẫn', [5, 6, 7, 10, 86]],
  ['robot', [8, 9, 10, 13, 18, 85]],
  ['Dung Quất', [61]],
  ['Hanoi Buffaloes', [30]],
  ['thu nhập của nhà vườn', [57, 58, 59]],
  ['doanh nghiệp tư nhân khó vay vốn', [4, 54]],
  ['tàu vũ trụ đáp xuống nguyệt cầu', [19, 50, 51, 52]],
  ['đội tuyển Việt Nam giành huy chương quốc tế', [30, 31, 32, 33, 34]],
  ['bảo vệ động vật hoang dã', [35, 36, 39]],
  ['ăn uống sai cách gây hại sức khỏe', [75, 77, 78]],
  ['robot humanoid', [8, 13]],
  ['du lich Hue', [22, 68]],
  ['công thức nấu bánh xèo', []],
];
const prefixQ = q => `task: search result | query: ${q}`;
const rankOf = (order, rel) => { const k = order.findIndex(i => rel.includes(i)); return k < 0 ? 0 : k + 1; };
const agg = { kw: [], vp: [], vn: [] };
const lat = [];
console.log('\n=== text -> document ===');
for (const [q, rel] of Q) {
  const wp = await embed([{ text: prefixQ(q) }]); lat.push(wp.ms);
  const np = await embed([{ text: q }]);
  const rank = v => docVecs.map((d, i) => [i, dot(v, d)]).sort((a, b) => b[1] - a[1]);
  const rp = rank(wp.v), rn = rank(np.v), kw = keyword(q);
  const ev = order => ({ first: rankOf(order, rel), p3: order.slice(0, 3).filter(i => rel.includes(i)).length / 3 });
  if (rel.length) { agg.kw.push(ev(kw)); agg.vp.push(ev(rp.map(x => x[0]))); agg.vn.push(ev(rn.map(x => x[0]))); }
  console.log(`\n"${q}"  relevant=${rel.length}  keyword hits=${kw.length}  vec top1 score=${rp[0][1].toFixed(3)} (noprefix ${rn[0][1].toFixed(3)})`);
  console.log(`  first-relevant rank: keyword=${rankOf(kw, rel) || '-'}  vec+prefix=${rankOf(rp.map(x => x[0]), rel) || '-'}  vec-noprefix=${rankOf(rn.map(x => x[0]), rel) || '-'}`);
  for (const [i, s] of rp.slice(0, 3)) console.log(`   ${rel.includes(i) ? '✓' : ' '} [${i}] ${s.toFixed(3)} ${seed[i].title.slice(0, 70)}`);
}
const mrr = a => (a.reduce((s, x) => s + (x.first ? 1 / x.first : 0), 0) / a.length).toFixed(3);
const p3 = a => (a.reduce((s, x) => s + x.p3, 0) / a.length).toFixed(3);
console.log(`\nSUMMARY over ${agg.vp.length} labelled queries (keyword order = table order, not ranked)`);
for (const [k, n] of [['kw', 'keyword'], ['vp', 'vector+prefix'], ['vn', 'vector no prefix']]) console.log(`  ${n.padEnd(18)} MRR=${mrr(agg[k])}  P@3=${p3(agg[k])}  found-any=${agg[k].filter(x => x.first).length}/${agg[k].length}`);
console.log(`query embedding latency ms: min=${Math.min(...lat)} median=${lat.sort((a, b) => a - b)[lat.length >> 1]} max=${Math.max(...lat)}`);

// ---- images ----
const picks = [0, 8, 20, 30, 36, 39, 51, 57, 71, 75, 23, 85];
const ext = u => (u.match(/\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i)?.[1] ?? 'bin').toLowerCase();
const imgs = [];
console.log('\n=== images ===');
for (const i of picks) {
  const a = seed[i]; const e = ext(a.image_url); const f = `${outDir}/imgs/${i}.${e}`;
  try {
    if (!existsSync(f)) { const r = await fetch(a.image_url, { headers: { 'user-agent': 'Mozilla/5.0' } }); if (!r.ok) throw new Error('download HTTP ' + r.status); writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    let use = f, mime = e === 'png' ? 'image/png' : 'image/jpeg';
    if (e === 'webp') {
      try { await embed([{ inlineData: { mimeType: 'image/webp', data: readFileSync(f).toString('base64') } }]); console.log(`  [${i}] raw webp ACCEPTED by API`); } catch (err) { console.log(`  [${i}] raw webp rejected: ${err.message}`); }
      use = f.replace(/\.webp$/, '.png'); execFileSync('sips', ['-s', 'format', 'png', f, '--out', use], { stdio: 'ignore' }); mime = 'image/png';
    }
    const r = await embed([{ inlineData: { mimeType: mime, data: readFileSync(use).toString('base64') } }]);
    imgs.push({ i, v: r.v, ms: r.ms, e });
  } catch (err) { console.log(`  [${i}] FAILED ${e}: ${err.message}`); }
}
console.log(`  embedded ${imgs.length}/${picks.length} images; latency ms median=${imgs.map(x => x.ms).sort((a, b) => a - b)[imgs.length >> 1]}`);

console.log('\n--- image -> own article (cross-modal, 90 docs) ---');
let top1 = 0; const ranks = [];
for (const m of imgs) { const order = docVecs.map((d, i) => [i, dot(m.v, d)]).sort((a, b) => b[1] - a[1]).map(x => x[0]); const r = order.indexOf(m.i) + 1; ranks.push(r); if (r === 1) top1++; }
console.log(`  own article at rank 1: ${top1}/${imgs.length}; ranks=${ranks.join(',')}`);

console.log('\n--- text -> image ---');
const IQ = ['biểu đồ thống kê', 'robot', 'con voi', 'cà phê', 'bóng rổ', 'món ăn', 'rùa', 'tàu vũ trụ'];
for (const q of IQ) {
  for (const [label, text] of [['prefix', prefixQ(q)], ['noprefix', q]]) {
    const v = (await embed([{ text }])).v;
    const top = imgs.map(m => [m, dot(v, m.v)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`  "${q}" ${label.padEnd(8)}: ` + top.map(([m, s]) => `[${m.i}] ${s.toFixed(2)} ${(seed[m.i].image_alt ?? seed[m.i].title).slice(0, 38)}`).join(' | '));
  }
}
