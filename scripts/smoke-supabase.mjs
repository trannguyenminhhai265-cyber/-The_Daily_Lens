// Live checks create uniquely named temporary records, then clean up only those records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { adminClient, checked, projectRef } from './supabase-admin.mjs';
const { createClient } = createRequire(new URL('../frontend/package.json',import.meta.url))('@supabase/supabase-js');
const url = process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`;
const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_GeNUn4UYJ1xpMElgnrRhRg_Xz686Vzu';
const admin = adminClient(), tempUsers = [], prefix = `smoke_${Date.now()}`;
const client = () => createClient(url, publishable, {auth:{persistSession:false,autoRefreshToken:false}});
let categoryId, docId;
const request = async (client,path,method='GET',body={},params={}) => checked(await client.rpc('portal_api',{path,method,body,params,session_id:prefix}));
const createUser = async (username,role,password) => {
  const email=`${username}@example.test`;
  const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username,display_name:username}}));
  tempUsers.push(user.id);
  if(role==='admin')checked(await admin.from('profiles').update({role}).eq('id',user.id));
  const signedIn=client(); checked(await signedIn.auth.signInWithPassword({email,password}));
  return signedIn;
};
try {
  const anonymous=client();
  const initial=await request(anonymous,'/documents','GET',{}, {limit:3,log:'false'});
  if(initial.items.length)assert(!('email' in initial.items[0].author));
  assert((await anonymous.from('profiles').select()).error,'Direct table access must be denied');
  assert((await anonymous.rpc('portal_api',{path:'/admin/stats'})).error,'Anonymous admin access must be denied');
  const password=`Smoke${randomUUID()}9!`;
  const staff=await createUser(prefix,'admin',password);
  const reader=await createUser(`${prefix}_r`,'user',password);
  assert.equal((await request(staff,'/auth/me')).user.role,'admin');
  assert((await reader.rpc('portal_api',{path:'/admin/stats'})).error);
  assert.equal((await request(reader,'/auth/me','PUT',{role:'admin',display_name:'Smoke reader'})).user.role,'user');
  categoryId=(await request(staff,'/categories','POST',{name:'Smoke test',slug:prefix})).category.id;
  const doc=(await request(staff,'/manage/documents','POST',{title:`Smoke ${prefix}`,summary:'Temporary integration test',content:'<p>Integration test</p>',category_id:categoryId,tags:[],source_url:'https://example.test/source'})).document;
  docId=doc.id;
  const searched=await request(anonymous,'/documents','GET',{}, {q:prefix}); assert.equal(searched.total,1);
  assert.equal((await request(anonymous,`/documents/${doc.slug}`)).document.id,doc.id);
  await request(reader,'/search/click','POST',{query_string:prefix,clicked_doc_id:doc.id,position:1});
  const logRows=(await request(staff,'/admin/search-logs','GET',{}, {q:prefix})).items;
  assert(logRows.some(log=>log.event==='click')); assert(logRows.every(log=>log.is_synthetic===false));
  const exported=(await request(staff,'/admin/export')).items;
  const row=exported.find(row=>row.id===doc.id); assert(row); assert(row.tags); assert(row.content_text || row.content);
  assert.equal((await request(staff,'/admin/stats')).totals.documents,initial.total+1);
  assert((await reader.rpc('portal_api',{path:`/manage/documents/${doc.id}`,method:'DELETE'})).error);
  await request(staff,`/manage/documents/${doc.id}`,'PUT',{title:'Updated smoke article',summary:'Updated',content:'<p>Updated integration test</p>',category_id:categoryId,tags:[]});
  assert.equal((await request(staff,`/manage/documents/${doc.id}`)).document.title,'Updated smoke article');
  await request(staff,`/manage/documents/${doc.id}`,'DELETE'); docId=null;
  await request(staff,`/categories/${categoryId}`,'DELETE'); categoryId=null;
  console.log('LIVE PASS: Auth login, admin/user permissions, article/taxonomy CRUD, dataset export, search and click logs.');
} finally {
  if(docId)checked(await admin.from('documents').delete().eq('id',docId));
  if(categoryId)checked(await admin.from('categories').delete().eq('id',categoryId));
  checked(await admin.from('search_logs').delete().eq('session_id',prefix));
  for(const id of tempUsers)checked(await admin.auth.admin.deleteUser(id));
  console.log('Temporary integration records cleaned up.');
}
