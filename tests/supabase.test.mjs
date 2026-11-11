import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
process.on('unhandledRejection', error => { console.error(error.message, error.where, error.internalQuery); process.exit(1); });
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
const reader = '00000000-0000-4000-8000-000000000001', admin = '00000000-0000-4000-8000-000000000002';
// Exercise the forward migration against populated historical tables, not just an empty schema.
for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
  if (file.startsWith('202611110005')) {
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'admin@test.example','{"username":"admin"}'),($2,'reader@test.example','{"username":"reader"}')`, [admin, reader]);
    await db.exec(`update public.profiles set role='content_manager' where id='${admin}';
      insert into public.categories(id,name,slug) values('10000000-0000-4000-8000-000000000001','Legacy','legacy');
      insert into public.documents(id,title,slug,summary,content,content_text,category_id,author,canonical_url) values('20000000-0000-4000-8000-000000000001','Legacy article','legacy-article','Summary','<p>Legacy content</p>','Legacy content','10000000-0000-4000-8000-000000000001','${admin}','https://example.test/source');
      insert into public.search_logs(query_string,event,session_id) values('legacy','search','seed-1');
      insert into public.likes(user_id,document_id) values('${reader}','20000000-0000-4000-8000-000000000001');`);
  }
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  console.log('Applied', file);
}
async function as(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); }
async function api(path, method = 'GET', body = {}, params = {}) { return (await db.query('select public.portal_api($1,$2,$3,$4,$5) result', [path, method, JSON.stringify(body), JSON.stringify(params), 'test-session'])).rows[0].result; }
async function denied(fn) { await assert.rejects(fn, /Permission denied|Authentication required|permission denied|Access denied|Admin/i); }
const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => row.tablename);
assert.deepEqual(tables, ['categories','document_tags','documents','profiles','search_logs','tags']);
assert.equal((await db.query('select count(*) as count from archive.likes')).rows[0].count,1);
assert.equal((await db.query('select count(*) as count from archive.documents')).rows[0].count,1);
assert.equal((await db.query("select source_url from public.documents where slug='legacy-article'")).rows[0].source_url, 'https://example.test/source');
assert.equal((await db.query("select is_synthetic from public.search_logs where session_id='seed-1'")).rows[0].is_synthetic, true);
await as(null); assert.equal((await api('/documents')).total, 1); await denied(() => api('/manage/documents')); await denied(() => db.exec('select * from public.profiles')); await denied(() => db.exec('select * from archive.documents')); await denied(() => api('/categories','POST',{name:'Forbidden'}));
await as(reader); await denied(() => api('/admin/stats')); const me = await api('/auth/me','PUT',{display_name:'Updated reader',role:'admin'}); assert.equal(me.user.role,'user'); assert.equal(me.user.display_name,'Updated reader');
await as(admin); assert.equal((await api('/auth/me')).user.role,'admin');
const cat = (await api('/categories','POST',{name:'Science'})).category;
let doc = (await api('/manage/documents','POST',{title:'Tin khoa học',summary:'Summary',content:'<p>Xin chào science</p>',category_id:cat.id,tags:'AI,Science',source_url:'https://example.test/article'})).document;
assert.equal(doc.tags.length,2); assert.equal(doc.author.id,admin); assert.equal(doc.slug,'tin-khoa-hoc'); assert(doc.content_text.includes('science'));
await as(null); assert.equal((await api('/documents','GET',{}, {q:'Xin science',category:cat.slug})).total,1);
assert.equal((await api(`/documents/${doc.slug}`)).document.views_count,1);
await api('/search/click','POST',{query_string:'science',clicked_doc_id:doc.id,position:1});
await as(reader); await denied(() => api(`/manage/documents/${doc.id}`,'DELETE'));
await as(admin); const logs = await api('/admin/search-logs'); assert(logs.items.some(log => log.event==='click' && log.clicked_doc_id));
const exported = (await api('/admin/export')).items; const row = exported.find(row => row.id===doc.id); assert(row); for (const field of ['id','title','content','summary','category_id','tags','author','created_at','views_count']) assert(field in row,`Export missing ${field}`);
assert.equal((await api('/admin/stats')).totals.documents,2);
const synthetic = await api('/admin/search-logs','GET',{}, {source:'synthetic'}); assert.equal(synthetic.total,1); assert(synthetic.items.every(log=>log.is_synthetic));
const collected = await api('/admin/search-logs','GET',{}, {source:'real'}); assert.equal(collected.total,2); assert(collected.items.every(log=>!log.is_synthetic));
await api(`/manage/documents/${doc.id}`,'PUT',{title:'Updated article',summary:'Updated',content:'<p>New content</p>',category_id:cat.id,tags:['AI']});
assert.equal((await api(`/manage/documents/${doc.id}`)).document.title,'Updated article');
await assert.rejects(() => api(`/categories/${cat.id}`,'DELETE'));
await api(`/manage/documents/${doc.id}`,'DELETE'); assert.equal((await api('/manage/documents')).total,1);
await api(`/categories/${cat.id}`,'DELETE');
for (const path of ['/admin/users','/admin/settings','/moderation/comments','/analytics/overview']) await assert.rejects(() => api(path));
await as(null); await assert.rejects(() => api(`/documents/${doc.id}`));
await db.close(); console.log('Core schema, forward migration, CRUD, export, search/click logs and access checks passed');
