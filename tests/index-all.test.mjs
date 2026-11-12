import { test, expect } from 'bun:test';
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { main, parseArgs, loadEnvFiles } = await import(`${R}/scripts/index-all.mjs`);
const fake = (docs, status) => ({ from: t => ({ select: () => ({ order: () => ({ range: async () => ({ data: t === 'documents' ? docs : status, error: null }) }) }) }) });
const docs = [1, 2, 3].map(i => ({ id: 'id' + i, title: 'Bài ' + i }));
const status = [{ document_id: 'id1', processed: true }, { document_id: 'id2', processed: false }];
test('dry run lists pending (id2,id3) and never calls indexDocument', async () => {
  const out = []; let called = 0;
  const r = await main(['--dry-run'], { supabase: fake(docs, status), indexDocument: async () => { called++; }, log: s => out.push(s) });
  expect(r.total).toBe(2); expect(called).toBe(0); expect(out.join('\n')).toContain('id3'); expect(out.join('\n')).not.toContain('id1 ');
});
test('--all + sequential run + failure counting + --limit', async () => {
  const seen = [];
  const r = await main(['--all', '--limit', '2'], { supabase: fake(docs, status), indexDocument: async (_s, id, o) => { seen.push([id, o.force]); return id === 'id2' ? { ok: false, error: 'x' } : { ok: true, image: true, indexed: true }; }, log() {} });
  expect(seen).toEqual([['id1', true], ['id2', true]]); expect(r).toMatchObject({ total: 2, indexed: 1, failed: 1 });
});
test('args and env parsing', () => {
  expect(() => parseArgs(['--bogus'])).toThrow(); expect(parseArgs(['--all', '--dry-run'])).toMatchObject({ all: true, dryRun: true });
  const env = { GEMINI_API_KEY: 'keep' }; loadEnvFiles(env, ['/nonexistent']); expect(env).toEqual({ GEMINI_API_KEY: 'keep' });
});
