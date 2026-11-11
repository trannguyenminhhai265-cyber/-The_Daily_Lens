// Optional seed for a NEW Supabase project; never run automatically during deployment.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { adminClient,checked } from './supabase-admin.mjs';
const articles=JSON.parse(readFileSync(new URL('../supabase/seed-data/articles-vnexpress.json',import.meta.url)));
const client=adminClient();
const email=process.env.SEED_ADMIN_EMAIL, password=process.env.SEED_ADMIN_PASSWORD;
if(!email || !password || password.length<12) throw Error('Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters.');
const existing=await client.from('documents').select('id',{count:'exact',head:true}); if(existing.error) throw existing.error;
if(existing.count) throw Error('Seed refused: articles already exist. No data was changed.');
const {user}=checked(await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username:'admin',display_name:'Administrator'}}));
checked(await client.from('profiles').update({role:'admin'}).eq('id',user.id));
const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('đ','d').replaceAll('Đ','D').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories=new Map(),tags=new Map();
for(const a of articles){
 if(!categories.has(a.category)) { const c=checked(await client.from('categories').upsert({name:a.category,slug:slug(a.category)},{onConflict:'slug'}).select().single());categories.set(a.category,c.id); }
 const id=randomUUID(), text=(a.paragraphs || [a.summary]).join('\n');
 checked(await client.from('documents').insert({id,title:a.title,slug:slug(a.title),summary:a.summary,content:(a.paragraphs||[a.summary]).map(p=>`<p>${escape(p)}</p>`).join('\n'),content_text:text,category_id:categories.get(a.category),author:user.id,cover_url:a.image_url||'',source_url:a.url}));
 for(const name of a.tags||[]) { if(!tags.has(name)){ const t=checked(await client.from('tags').upsert({name,slug:slug(name)},{onConflict:'slug'}).select().single());tags.set(name,t.id); } checked(await client.from('document_tags').upsert({document_id:id,tag_id:tags.get(name)})); }
}
console.log(`Seeded ${articles.length} articles; ${categories.size} categories; ${tags.size} tags. No demo password was added.`);
