// Index documents for vector search, one at a time, using the same core as POST /api/admin/index-document.
//   bun run index                 index documents not yet processed
//   bun run index -- --all        re-index everything (also re-embeds cover images)
//   bun run index -- --dry-run    list what would be indexed; no Gemini calls, no writes
//   bun run index -- --limit 10   stop after N documents
//   bun run index -- --rpm 20     pace Gemini calls (each document costs up to 2); default 20 on real runs
// Needs SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY (from the environment, .env or frontend/.env). Never prints keys.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFiles(env = process.env, files = [join(root, '.env'), join(root, 'frontend', '.env')]) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || m[1].startsWith('#')) continue;
      const value = m[2].replace(/^(["'])(.*)\1$/, '$2');
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = value;
    }
  }
  if (!env.SUPABASE_URL && env.VITE_SUPABASE_URL) env.SUPABASE_URL = env.VITE_SUPABASE_URL;
}

export function parseArgs(argv) {
  const opts = { all: false, dryRun: false, limit: Infinity, rpm: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') opts.all = true;
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--limit') { opts.limit = Number(argv[++i]); if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new Error('--limit needs a positive integer'); }
    else if (argv[i] === '--rpm') { opts.rpm = Number(argv[++i]); if (!Number.isFinite(opts.rpm) || opts.rpm <= 0) throw new Error('--rpm needs a positive number'); }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return opts;
}

async function fetchAll(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order(columns.split(',')[0]).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function listTargets(supabase, { all }) {
  const docs = await fetchAll(supabase, 'documents', 'id,title');
  if (all) return docs;
  const status = new Map((await fetchAll(supabase, 'search_index_status', 'document_id,processed')).map(r => [r.document_id, r.processed]));
  return docs.filter(d => status.get(d.id) !== true);
}

export async function main(argv, { supabase, indexDocument, log = console.log, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const opts = parseArgs(argv);
  if (!supabase) {
    loadEnvFiles();
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example) in .env or the environment.');
    supabase = (await import('../api/_lib/supabase.js')).getAdminClient();
  }
  const targets = (await listTargets(supabase, opts)).slice(0, opts.limit);
  log(`${targets.length} document(s) to index${opts.all ? ' (--all)' : ''}${opts.dryRun ? ' [dry run]' : ''}`);
  if (opts.dryRun) { targets.forEach((d, i) => log(`  ${String(i + 1).padStart(3)}. ${d.id}  ${d.title}`)); return { total: targets.length, indexed: 0, failed: 0 }; }
  if (!indexDocument) {
    if (opts.rpm == null) opts.rpm = 20;
    if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY (see .env.example) in .env or the environment.');
    indexDocument = (await import('../api/_lib/indexer.js')).indexDocument;
  }
  let indexed = 0, failed = 0, stale = 0, streak = 0;
  const gap = opts.rpm ? Math.ceil(120000 / opts.rpm) : 0; // up to 2 Gemini calls per document
  for (const [i, d] of targets.entries()) {
    const started = Date.now();
    const r = await indexDocument(supabase, d.id, { force: opts.all });
    const tag = `[${i + 1}/${targets.length}]`;
    if (!r.ok) { failed++; log(`${tag} FAILED ${d.title.slice(0, 60)}: ${r.error}`); }
    else if (r.stale) { stale++; log(`${tag} changed during indexing, left queued: ${d.title.slice(0, 60)}`); }
    else { indexed++; log(`${tag} ok${r.image ? ' +image' : ''}  ${d.title.slice(0, 60)}`); }
    streak = r.ok ? 0 : streak + 1;
    if (streak >= 3) { log('3 failures in a row (likely rate limit or quota): stopping. Wait a few minutes and run again.'); break; }
    const wait = gap - (Date.now() - started);
    if (wait > 0 && i < targets.length - 1) await sleep(wait);
  }
  log(`Done: ${indexed} indexed, ${failed} failed, ${stale} re-queued.`);
  return { total: targets.length, indexed, failed, stale };
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(r => { if (r.failed) process.exitCode = 1; }).catch(err => { console.error(err.message); process.exit(1); });
}
