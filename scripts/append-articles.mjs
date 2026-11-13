// Append articles from a seed JSON file to an existing Supabase project.
//   bun scripts/append-articles.mjs [file] [--dry-run]
// Default file: supabase/seed-data/articles-vnexpress.json. Articles whose source_url or title already exists are skipped,
// so it is safe to re-run. Author = the oldest admin profile. New rows are queued for search indexing by trigger;
// run `bun run index` afterwards to embed them.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { adminClient, checked } from './supabase-admin.mjs';
import { loadEnvFiles } from './index-all.mjs';

loadEnvFiles();
const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const file = args.find(a => !a.startsWith('--')) || new URL('../supabase/seed-data/articles-vnexpress.json', import.meta.url);
const articles = JSON.parse(readFileSync(file, 'utf8'));
const client = adminClient();

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replaceAll('đ', 'd').replaceAll('Đ', 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escape = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const admin = checked(await client.from('profiles').select('id').eq('role', 'admin').order('created_at').limit(1).maybeSingle());
if (!admin) throw Error('No admin profile found; run the seed for a new project first.');
// Older rows may have an empty source_url, so match on title as well.
const live = checked(await client.from('documents').select('title,source_url'));
const urls = new Set(live.map(d => d.source_url).filter(Boolean)), titles = new Set(live.map(d => d.title));
const todo = articles.filter(a => !urls.has(a.url) && !titles.has(a.title));
console.log(`${articles.length} in file, ${articles.length - todo.length} already in database, ${todo.length} to insert.`);
if (dryRun) { for (const a of todo) console.log(`  [${a.category}] ${a.title}`); process.exit(0); }

const categories = new Map(checked(await client.from('categories').select('id,slug')).map(c => [c.slug, c.id]));
const tags = new Map(checked(await client.from('tags').select('id,slug')).map(t => [t.slug, t.id]));
for (const a of todo) {
  const cs = slug(a.category);
  if (!categories.has(cs)) categories.set(cs, checked(await client.from('categories').upsert({ name: a.category, slug: cs }, { onConflict: 'slug' }).select().single()).id);
  const id = randomUUID(), paragraphs = a.paragraphs || [a.summary];
  let s = slug(a.title);
  if (checked(await client.from('documents').select('id').eq('slug', s)).length) s += '-' + id.slice(0, 6);
  checked(await client.from('documents').insert({
    id, title: a.title, slug: s, summary: a.summary,
    content: paragraphs.map(p => `<p>${escape(p)}</p>`).join('\n'), content_text: paragraphs.join('\n'),
    category_id: categories.get(cs), author: admin.id, cover_url: a.image_url || '', source_url: a.url,
  }));
  for (const name of a.tags || []) {
    const ts = slug(name);
    if (!tags.has(ts)) tags.set(ts, checked(await client.from('tags').upsert({ name, slug: ts }, { onConflict: 'slug' }).select().single()).id);
    checked(await client.from('document_tags').upsert({ document_id: id, tag_id: tags.get(ts) }));
  }
  console.log(`  + ${a.title}`);
}
console.log(`Inserted ${todo.length} articles.`);
