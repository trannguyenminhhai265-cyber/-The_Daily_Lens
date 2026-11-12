// Đánh giá tìm kiếm trên dữ liệu seed: tìm từ khóa (mô phỏng private.list_documents) và tìm vector (cosine).
// Cách dùng:
//   bun scripts/eval-search.mjs <file-env> <seed.json> <queries.json> <thư-mục-cache> [--dry-run]
// - file-env: chứa GEMINI_API_KEY; script không in khóa ra màn hình.
// - queries.json: [{"query":"...","relevant_ids":[...],"type":"normal"|"junk"}].
//   relevant_ids là chỉ số 0-based trong seed (seed không có id). Trường khác (ví dụ "note") bị bỏ qua.
// - Cache vector: <thư-mục-cache>/embed-cache.json. Chạy lại không gọi lại API cho nội dung đã có.
// - --dry-run: chỉ kiểm tra file đầu vào và in số lượng, số vector còn thiếu. Không đọc khóa, không gọi API, không ghi file.
// Nhãn phải do người khác soạn; script không kiểm chứng nhãn. Chỉ query normal được tính P@3, P@5, MRR, nDCG@5;
// query junk dùng để chọn ngưỡng điểm top 1.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MODEL = 'gemini-embedding-2';
const DIM = 768;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;
const CONCURRENCY = 4;
const MIN_NORMAL_QUERIES = 30;

const fail = msg => { console.error(`Lỗi: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [envPath, seedPath, queriesPath, cacheDir] = args.filter(a => !a.startsWith('--'));
if (!envPath || !seedPath || !queriesPath || !cacheDir) {
  console.error('Cách dùng: bun scripts/eval-search.mjs <file-env> <seed.json> <queries.json> <thư-mục-cache> [--dry-run]');
  process.exit(2);
}

// ---- seed và prompt (cùng cách với scripts/embedding-probe.mjs) ----
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
if (!Array.isArray(seed) || seed.length === 0) fail('seed phải là mảng không rỗng');
const docText = a => `${a.summary ?? ''}\n${(a.paragraphs ?? []).join('\n')}`.trim();
const docPrompt = a => `title: ${a.title} | text: ${docText(a)}`;
const queryPrompt = q => `task: search result | query: ${q}`;

// ---- đọc và kiểm tra file query ----
function loadQueries(path, nDocs) {
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { fail(`không đọc được ${path}: ${e.message}`); }
  if (!Array.isArray(data) || data.length === 0) fail('file query phải là mảng không rỗng');
  const errors = [];
  data.forEach((row, i) => {
    const r = row ?? {};
    const at = `mục ${i + 1}`;
    if (typeof r.query !== 'string' || !r.query.trim()) errors.push(`${at}: thiếu query`);
    if (r.type !== 'normal' && r.type !== 'junk') errors.push(`${at}: type phải là normal hoặc junk`);
    const idsOk = Array.isArray(r.relevant_ids) && r.relevant_ids.every(id => Number.isInteger(id) && id >= 0 && id < nDocs);
    if (!idsOk) errors.push(`${at}: relevant_ids phải là mảng chỉ số trong khoảng 0..${nDocs - 1}`);
    else if (r.type === 'normal' && r.relevant_ids.length === 0) errors.push(`${at}: query normal cần ít nhất 1 relevant_id`);
    else if (r.type === 'junk' && r.relevant_ids.length > 0) errors.push(`${at}: query junk phải có relevant_ids rỗng`);
  });
  if (errors.length) fail(errors.slice(0, 20).join('; '));
  return data.map(r => ({ query: r.query.trim(), relevant: new Set(r.relevant_ids), type: r.type }));
}
const queries = loadQueries(queriesPath, seed.length);
const normals = queries.filter(q => q.type === 'normal');
const junks = queries.filter(q => q.type === 'junk');

// ---- cache embedding ----
const cachePath = join(cacheDir, 'embed-cache.json');
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const keyOf = text => createHash('sha256').update(`${MODEL}|${DIM}|${text}`).digest('hex');
const vecOf = text => cache[keyOf(text)];

const docPrompts = seed.map(docPrompt);
const queryPrompts = queries.map(q => queryPrompt(q.query));
const allPrompts = [...new Set([...docPrompts, ...queryPrompts])];
const missing = allPrompts.filter(t => !vecOf(t));

if (dryRun) {
  const relPairs = queries.reduce((s, q) => s + q.relevant.size, 0);
  console.log('Dry-run: kiểm tra đầu vào, không gọi API, không ghi file.');
  console.log(`  seed: ${seed.length} bài`);
  console.log(`  query: ${queries.length} (normal ${normals.length}, junk ${junks.length}); cặp relevant: ${relPairs}`);
  console.log(`  vector cần có: ${allPrompts.length}; đã có trong cache: ${allPrompts.length - missing.length}; còn thiếu (sẽ gọi API): ${missing.length}`);
  if (normals.length < MIN_NORMAL_QUERIES) console.log(`  cảnh báo: mới ${normals.length} query normal; nên có ${MIN_NORMAL_QUERIES}-50 để số liệu đáng tin.`);
  if (junks.length === 0) console.log('  cảnh báo: chưa có query junk, chưa chọn được ngưỡng điểm.');
  process.exit(0);
}

// ---- embed (cùng cách với probe: normalize, retry 429/5xx với backoff) ----
function readKey(path) {
  const line = readFileSync(path, 'utf8').split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
  const key = line?.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key) fail('không tìm thấy GEMINI_API_KEY trong file env');
  return key;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const normalize = v => { const n = Math.hypot(...v); return v.map(x => x / n); };

async function embedOne(key, text) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: DIM }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const values = body.embedding?.values;
      if (!Array.isArray(values) || values.length !== DIM) throw new Error('phản hồi không đúng dạng: ' + Object.keys(body).join(','));
      return normalize(values);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`HTTP ${res.status}: ${body.error?.message?.slice(0, 200) ?? 'không rõ'}`);
  }
}

let calls = 0;
const save = () => {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
};
if (missing.length) {
  const key = readKey(envPath);
  console.log(`Gọi API cho ${missing.length} vector còn thiếu...`);
  let i = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
      while (i < missing.length) {
        const text = missing[i++];
        cache[keyOf(text)] = await embedOne(key, text);
        calls++;
      }
    }));
  } finally {
    if (calls) save();
  }
}

// ---- xếp hạng ----
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const docVecs = docPrompts.map(vecOf);
function vectorRank(qv) {
  return docVecs.map((d, i) => ({ i, s: dot(qv, d) })).sort((a, b) => b.s - a.s);
}

// Tìm từ khóa giống private.list_documents: cắt 200 ký tự, tách theo khoảng trắng, mọi từ phải là chuỗi con
// (không phân biệt hoa thường) trong title || summary || content_text. content_text được xấp xỉ bằng đoạn văn seed.
// Kết quả không có thứ hạng; script giữ thứ tự seed (SQL sắp theo created_at desc, seed không có created_at).
const hay = seed.map(a => `${a.title ?? ''} ${a.summary ?? ''} ${(a.paragraphs ?? []).join(' ')}`.toLowerCase());
function keywordRank(q) {
  const terms = q.trim().slice(0, 200).split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
  return seed.map((_, i) => i).filter(i => terms.every(t => hay[i].includes(t)));
}

// ---- số liệu (chỉ cho query normal, relevant là chỉ số bài) ----
function metrics(ranking, rel) {
  const pAt = k => ranking.slice(0, k).filter(i => rel.has(i)).length / k;
  const first = ranking.findIndex(i => rel.has(i));
  const dcg = ranking.slice(0, 5).reduce((s, i, r) => s + (rel.has(i) ? 1 / Math.log2(r + 2) : 0), 0);
  let idcg = 0;
  for (let r = 0; r < Math.min(5, rel.size); r++) idcg += 1 / Math.log2(r + 2);
  return { p3: pAt(3), p5: pAt(5), mrr: first < 0 ? 0 : 1 / (first + 1), ndcg5: dcg / idcg, first: first < 0 ? null : first + 1 };
}
const mean = (rows, f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const f3 = x => x.toFixed(3);

const kwRows = normals.map(q => metrics(keywordRank(q.query), q.relevant));
const vecRows = normals.map(q => metrics(vectorRank(vecOf(queryPrompt(q.query))).map(x => x.i), q.relevant));

console.log(`\nSeed ${seed.length} bài; ${normals.length} query normal; ${junks.length} query junk. API đã gọi: ${calls}.`);
if (normals.length < MIN_NORMAL_QUERIES) console.log(`Cảnh báo: chỉ ${normals.length} query normal (nên có ${MIN_NORMAL_QUERIES}-50); số liệu chưa đủ tin cậy.`);
console.log('Nhãn phải do người khác soạn; script không kiểm chứng nhãn.\n');

console.log('Chỉ số'.padEnd(10) + 'Từ khóa'.padStart(10) + 'Vector'.padStart(10));
for (const [name, f] of [['P@3', r => r.p3], ['P@5', r => r.p5], ['MRR', r => r.mrr], ['nDCG@5', r => r.ndcg5]]) {
  console.log(name.padEnd(10) + f3(mean(kwRows, f)).padStart(10) + f3(mean(vecRows, f)).padStart(10));
}

console.log('\nChi tiết query normal (thứ hạng đầu tiên của bài đúng; "-" nếu không có):');
normals.forEach((q, n) => {
  const top = vectorRank(vecOf(queryPrompt(q.query)))[0];
  console.log(`  ${q.query.slice(0, 40).padEnd(40)} từ khóa=${String(kwRows[n].first ?? '-').padStart(3)} vector=${String(vecRows[n].first ?? '-').padStart(3)} top1=${f3(top.s)}`);
});

// ---- query junk: điểm top 1 và ngưỡng ----
const junkTop = junks.map(q => {
  const top = vectorRank(vecOf(queryPrompt(q.query)))[0];
  return { query: q.query, s: top.s, title: seed[top.i].title, kw: keywordRank(q.query).length };
});
const normalTop = normals.map(q => vectorRank(vecOf(queryPrompt(q.query)))[0].s);

console.log('\nQuery junk (không có bài đúng; top 1 càng thấp càng tốt):');
if (!junkTop.length) console.log('  (không có)');
for (const j of junkTop) console.log(`  ${j.query.slice(0, 40).padEnd(40)} top1=${f3(j.s)} từ khóa=${j.kw} | ${j.title.slice(0, 50)}`);

if (junkTop.length && normalTop.length) {
  console.log('\nNgưỡng top 1 (cắt kết quả nếu top 1 < ngưỡng):');
  console.log('  ngưỡng   junk bị cắt   normal còn kết quả');
  for (let c = 50; c <= 80; c += 2) {
    const t = c / 100;
    const cut = junkTop.filter(j => j.s < t).length / junkTop.length;
    const keep = normalTop.filter(s => s >= t).length / normalTop.length;
    console.log(`  ${f3(t).padEnd(8)} ${(cut * 100).toFixed(0).padStart(3)}% (${junkTop.filter(j => j.s < t).length}/${junkTop.length})   ${(keep * 100).toFixed(0).padStart(3)}% (${normalTop.filter(s => s >= t).length}/${normalTop.length})`);
  }
  console.log(`  top 1 query normal: min=${f3(Math.min(...normalTop))} median=${f3([...normalTop].sort((a, b) => a - b)[normalTop.length >> 1])}`);
  console.log(`  top 1 query junk:   min=${f3(Math.min(...junkTop.map(j => j.s)))} max=${f3(Math.max(...junkTop.map(j => j.s)))}`);
}
