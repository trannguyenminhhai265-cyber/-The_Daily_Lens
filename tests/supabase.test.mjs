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
  // PGlite has no pgvector; this migration is only verifiable against a real Supabase/Postgres with the extension.
  if (file.includes('vector_search')) { console.log('Skipped', file, '(needs pgvector)'); continue; }
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  console.log('Applied', file);
}
async function as(id) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); }
async function api(path, method = 'GET', body = {}, params = {}) { return (await db.query('select public.portal_api($1,$2,$3,$4,$5) result', [path, method, JSON.stringify(body), JSON.stringify(params), 'test-session'])).rows[0].result; }
async function denied(fn) { await assert.rejects(fn, /Permission denied|Authentication required|permission denied|Access denied|Admin/i); }
const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => row.tablename);
assert.deepEqual(tables, ['categories','document_tags','documents','profiles','search_index_status','search_logs','tags']);
// Search engine part 1: the historical document was queued by the backfill; legacy logs are labelled keyword/text.
assert.deepEqual((await db.query("select processed from public.search_index_status where document_id='20000000-0000-4000-8000-000000000001'")).rows, [{processed:false}]);
assert.deepEqual((await db.query("select engine,query_type from public.search_logs where session_id='seed-1'")).rows, [{engine:'keyword',query_type:'text'}]);
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
// Indexing queue: edits that change embedded fields re-queue the document; views and no-op saves do not.
const owner = async sql => { await db.exec('reset role'); return (await db.query(sql)).rows; };
const queued = async () => (await owner(`select processed from public.search_index_status where document_id='${doc.id}'`))[0].processed;
assert.equal(await queued(), false);
await owner(`update public.search_index_status set processed=true where document_id='${doc.id}'`);
await as(null); await api(`/documents/${doc.slug}`); await as(admin);
assert.equal(await queued(), true);
await as(admin); await api(`/manage/documents/${doc.id}`,'PUT',{title:'Updated article',summary:'Updated',content:'<p>New content</p>',category_id:cat.id,tags:['AI']});
assert.equal(await queued(), true);
await api(`/manage/documents/${doc.id}`,'PUT',{title:'Updated article',summary:'Updated',content:'<p>Changed again</p>',category_id:cat.id,tags:['AI']});
assert.equal(await queued(), false);
// Search logs: image searches need no text, text searches still do, and an image search is always a vector search.
await owner(`insert into public.search_logs(query_string,event,engine,query_type) values('','search','vector','image')`);
await assert.rejects(() => owner(`insert into public.search_logs(query_string,event) values('  ','search')`));
await assert.rejects(() => owner(`insert into public.search_logs(query_string,event,engine,query_type) values('','search','keyword','image')`));
// Search click logging: engine is whitelisted (keyword/vector/hybrid, anything else -> keyword), query_type defaults to text.
const ownerExec = async sql => { await db.exec('reset role'); await db.exec(sql); };
const legacyId = '20000000-0000-4000-8000-000000000001';
await as(null);
for (const [engine, expected] of [['vector','vector'],['hybrid','hybrid'],['keyword','keyword'],['bogus','keyword'],[undefined,'keyword'],[null,'keyword']])
  await api('/search/click','POST',{query_string:`engine-${engine}`,clicked_doc_id:doc.id,position:1,...(engine === undefined ? {} : {engine})});
await api('/search/click','POST',{query_string:'',clicked_doc_id:doc.id,position:2,engine:'keyword',query_type:'image'});
await api('/search/click','POST',{query_string:'typed',clicked_doc_id:doc.id,position:3,engine:'vector',query_type:'nonsense'});
await as(admin);
const clickRows = (await owner(`select query_string,engine,query_type from public.search_logs where event='click' and session_id='test-session' order by query_string`));
const byQuery = Object.fromEntries(clickRows.map(row => [row.query_string,row]));
assert.equal(byQuery['engine-vector'].engine,'vector'); assert.equal(byQuery['engine-hybrid'].engine,'hybrid'); assert.equal(byQuery['engine-keyword'].engine,'keyword');
assert.equal(byQuery['engine-bogus'].engine,'keyword'); assert.equal(byQuery['engine-undefined'].engine,'keyword'); assert.equal(byQuery['engine-null'].engine,'keyword');
assert(clickRows.every(row => row.query_string === '' ? row.query_type === 'image' : row.query_type === 'text'));
assert.equal(byQuery[''].engine,'vector'); assert.equal(byQuery[''].query_type,'image'); // image clicks are always vector
assert.equal(byQuery['typed'].query_type,'text'); assert.equal(byQuery['typed'].engine,'vector');
await as(null); await assert.rejects(() => api('/search/click','POST',{query_string:'  ',clicked_doc_id:doc.id,position:1})); // text click still needs text
// /admin/search-logs filters by engine and query_type and returns both columns.
await as(admin);
const vectorLogs = await api('/admin/search-logs','GET',{}, {engine:'vector'});
assert(vectorLogs.total >= 3 && vectorLogs.items.every(log => log.engine==='vector' && log.query_type));
assert.equal((await api('/admin/search-logs','GET',{}, {engine:'hybrid'})).total,1);
const imageLogs = await api('/admin/search-logs','GET',{}, {query_type:'image'});
assert(imageLogs.total >= 2 && imageLogs.items.every(log => log.query_type==='image' && log.engine==='vector'));
const textKeyword = await api('/admin/search-logs','GET',{}, {engine:'keyword',query_type:'text'});
assert(textKeyword.total >= 1 && textKeyword.items.every(log => log.engine==='keyword' && log.query_type==='text'));
assert.equal((await api('/admin/search-logs')).total, (await api('/admin/search-logs','GET',{}, {engine:'',query_type:''})).total);
// /admin/search-engine: admin only, fixed shape, errors first. image_embeddings is stubbed because PGlite has no pgvector.
await as(null); await denied(() => api('/admin/search-engine')); await as(reader); await denied(() => api('/admin/search-engine')); await as(admin);
let engine = await api('/admin/search-engine');
assert.deepEqual(Object.keys(engine).sort(),['documents','images_embedded','images_expected','indexed','pending','total']);
assert.deepEqual([engine.total,engine.indexed,engine.pending,engine.images_embedded,engine.images_expected],[2,0,2,0,0]);
await ownerExec(`update public.documents set cover_url='https://example.test/cover.png' where id='${doc.id}'; update public.search_index_status set last_error='boom' where document_id='${legacyId}'`);
engine = await api('/admin/search-engine');
assert.equal(engine.images_expected,1); assert.equal(engine.documents.length,2);
assert.deepEqual(Object.keys(engine.documents[0]).sort(),['has_image','id','image_embedded','last_error','processed','title','updated_at']);
assert.deepEqual(engine.documents.map(row => row.id),[legacyId,doc.id]); // errored document first
assert.equal(engine.documents[0].last_error,'boom'); assert.equal(engine.documents[1].last_error,null);
assert.deepEqual(engine.documents.map(row => [row.processed,row.has_image,row.image_embedded]),[[false,false,false],[false,true,false]]);
await ownerExec(`create table public.image_embeddings(document_id uuid, image_url text); insert into public.image_embeddings values('${doc.id}','https://example.test/old.png')`);
assert.equal((await api('/admin/search-engine')).images_embedded,0); // embedding of a replaced cover does not count
await ownerExec(`insert into public.image_embeddings values('${doc.id}','https://example.test/cover.png'); update public.search_index_status set processed=true where document_id='${doc.id}'`);
engine = await api('/admin/search-engine');
assert.deepEqual([engine.indexed,engine.pending,engine.images_embedded,engine.images_expected],[1,1,1,1]);
assert.deepEqual(engine.documents.map(row => [row.id,row.processed,row.image_embedded]),[[legacyId,false,false],[doc.id,true,true]]);
await ownerExec(`drop table public.image_embeddings; update public.search_index_status set last_error=null where document_id='${legacyId}'`);
await as(admin);
// Browser roles cannot read or write the queue.
await as(reader); await denied(() => db.exec('select * from public.search_index_status')); await denied(() => db.exec('update public.search_index_status set processed=true'));
await as(admin);
await assert.rejects(() => api(`/categories/${cat.id}`,'DELETE'));
await api(`/manage/documents/${doc.id}`,'DELETE'); assert.equal((await api('/manage/documents')).total,1);
assert.equal((await owner(`select count(*)::int as count from public.search_index_status where document_id='${doc.id}'`))[0].count,0); await as(admin);
await api(`/categories/${cat.id}`,'DELETE');
for (const path of ['/admin/users','/admin/settings','/moderation/comments','/analytics/overview']) await assert.rejects(() => api(path));
await as(null); await assert.rejects(() => api(`/documents/${doc.id}`));
await db.close(); console.log('Core schema, forward migration, CRUD, export, search/click logs and access checks passed');
