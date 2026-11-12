-- Search engine, part 3: portal_api support for the new search engine (no pgvector needed; see 0004 for the vector function).
-- Replaces public.portal_api (latest definition: migration 005) with these changes only:
--   * /search/click records engine ('keyword','vector','hybrid') and query_type ('text','image')
--   * new GET /admin/search-engine (indexing status for the admin tab)
--   * GET /admin/search-logs accepts optional engine and query_type filters
-- Everything else is copied unchanged.

-- 'hybrid' is a third engine value; the original check from migration 0001 only allowed keyword/vector.
alter table public.search_logs drop constraint search_logs_engine_check;
alter table public.search_logs add constraint search_logs_engine_check check (engine in ('keyword','vector','hybrid'));

create or replace function public.portal_api(path text, method text default 'GET', body jsonb default '{}', params jsonb default '{}', session_id text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 uid uuid:=auth.uid(); parts text[]:=string_to_array(trim(both '/' from path),'/');
 d public.documents; ident uuid; items jsonb; result jsonb; n integer;
 page_no integer:=greatest(1,coalesce((params->>'page')::int,1)); page_size integer:=least(100,greatest(1,coalesce((params->>'limit')::int,30)));
 tag_name text; tag_slug text; tag_id uuid; base_slug text;
 click_engine text; click_type text; embedded_ids uuid[]:='{}';
begin
 body:=coalesce(body,'{}'); params:=coalesce(params,'{}'); session_id:=left(coalesce(session_id,''),64);
 if uid is not null and not exists(select 1 from public.profiles where id=uid) then raise sqlstate '42501' using message='Account not available'; end if;
 if method not in ('GET','POST','PUT','DELETE') then raise sqlstate '22023' using message='Invalid method'; end if;

 -- Profiles contain no credentials and self-edits cannot modify role or username.
 if path='/auth/me' then
  if uid is null then raise sqlstate '42501' using message='Authentication required'; end if;
  if method='PUT' then update public.profiles set display_name=coalesce(body->>'display_name',display_name),updated_at=now() where id=uid;
  elsif method<>'GET' then raise sqlstate '22023' using message='Invalid method'; end if;
  return jsonb_build_object('user',private.profile_json(uid,true));
 end if;

 if parts[1] in ('categories','tags') then
  if method='GET' and parts[2] is null then
   if parts[1]='categories' then
    select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('count',(select count(*) from public.documents where category_id=c.id)) order by c.name),'[]') into items from public.categories c;
   else
    select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('count',(select count(*) from public.document_tags where tag_id=t.id)) order by t.name),'[]') into items from public.tags t;
   end if;
   return jsonb_build_object('items',items);
  end if;
  perform private.require_admin();
  if parts[2] is not null then ident:=parts[2]::uuid; end if;
  tag_slug:=private.slug(coalesce(nullif(body->>'slug',''),body->>'name'));
  if parts[1]='categories' then
   if method='POST' and parts[2] is null then insert into public.categories(name,slug) values(trim(body->>'name'),tag_slug) returning id into ident;
   elsif method='PUT' and ident is not null then update public.categories set name=coalesce(nullif(trim(body->>'name'),''),name),slug=case when body ? 'slug' then tag_slug else slug end,updated_at=now() where id=ident;
   elsif method='DELETE' and ident is not null then
    if exists(select 1 from public.documents where category_id=ident) then
     if params->>'reassign_to' is null or (params->>'reassign_to')::uuid=ident then raise sqlstate '22023' using message='Choose another category for these articles'; end if;
     update public.documents set category_id=(params->>'reassign_to')::uuid where category_id=ident;
    end if;
    delete from public.categories where id=ident;
   else raise sqlstate '22023' using message='Invalid taxonomy operation'; end if;
   select to_jsonb(c) into result from public.categories c where id=ident;
  else
   if method='POST' and parts[2] is null then insert into public.tags(name,slug) values(trim(body->>'name'),tag_slug) returning id into ident;
   elsif method='PUT' and ident is not null then update public.tags set name=coalesce(nullif(trim(body->>'name'),''),name),slug=case when body ? 'name' or body ? 'slug' then tag_slug else slug end,updated_at=now() where id=ident;
   elsif method='DELETE' and ident is not null then delete from public.tags where id=ident;
   else raise sqlstate '22023' using message='Invalid taxonomy operation'; end if;
   select to_jsonb(t) into result from public.tags t where id=ident;
  end if;
  return case when method='DELETE' then jsonb_build_object('ok',true) else jsonb_build_object(case when parts[1]='categories' then 'category' else 'tag' end,result) end;
 end if;

 if path='/documents' and method='GET' then
  result:=private.list_documents(params);
  if coalesce(trim(params->>'q'),'')<>'' and page_no=1 and coalesce(params->>'log','')<>'false' then
   insert into public.search_logs(user_id,query_string,event,results_count,session_id) values(uid,left(trim(params->>'q'),300),'search',(result->>'total')::int,session_id);
  end if;
  return result;
 end if;
 if parts[1]='documents' and cardinality(parts)=2 and method='GET' then
  update public.documents set views_count=views_count+1 where slug=parts[2] or id::text=parts[2] returning * into d;
  if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
  return jsonb_build_object('document',private.document_json(d));
 end if;
 if path='/search/click' and method='POST' then
  if not exists(select 1 from public.documents where id=(body->>'clicked_doc_id')::uuid) then raise sqlstate 'P0002' using message='Article not found'; end if;
  -- Unknown or missing values fall back to keyword/text; an image search is always a vector search (table constraint).
  click_type:=case when body->>'query_type'='image' then 'image' else 'text' end;
  click_engine:=case when click_type='image' then 'vector' when body->>'engine' in ('keyword','vector','hybrid') then body->>'engine' else 'keyword' end;
  insert into public.search_logs(user_id,query_string,clicked_doc_id,event,position,session_id,engine,query_type)
   values(uid,left(trim(coalesce(body->>'query_string','')),300),(body->>'clicked_doc_id')::uuid,'click',(body->>'position')::integer,session_id,click_engine,click_type);
  return jsonb_build_object('ok',true);
 end if;

 if parts[1]='manage' and parts[2]='documents' then
  perform private.require_admin();
  if parts[4] is not null then raise sqlstate 'P0002' using message='Route not found'; end if;
  if method='GET' then
   if parts[3] is null then return private.list_documents(params); end if;
   select * into d from public.documents where id=parts[3]::uuid;
  elsif method='DELETE' and parts[3] is not null then
   delete from public.documents where id=parts[3]::uuid;
   return jsonb_build_object('ok',true);
  elsif method in ('POST','PUT') then
   if method='POST' and parts[3] is null then ident:=gen_random_uuid();
   elsif method='PUT' and parts[3] is not null then
    select * into d from public.documents where id=parts[3]::uuid for update;
    if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
    ident:=d.id;
   else raise sqlstate '22023' using message='Invalid article operation'; end if;
   if method='POST' then
    base_slug:=private.slug(coalesce(body->>'slug',body->>'title')); tag_slug:=base_slug; n:=2;
    if base_slug='' then raise sqlstate '22023' using message='Title is required'; end if;
    while exists(select 1 from public.documents where slug=tag_slug) loop tag_slug:=base_slug||'-'||n; n:=n+1; end loop;
    insert into public.documents(id,title,slug,summary,content,category_id,author)
     values(ident,body->>'title',tag_slug,body->>'summary',body->>'content',(body->>'category_id')::uuid,uid);
   end if;
   update public.documents set title=coalesce(body->>'title',title),summary=coalesce(body->>'summary',summary),content=coalesce(body->>'content',content),
    content_text=case when body ? 'content' then trim(regexp_replace(regexp_replace(body->>'content','<[^>]*>',' ','g'),E'\\s+',' ','g')) else content_text end,
    category_id=coalesce((body->>'category_id')::uuid,category_id),cover_url=coalesce(body#>>'{cover_image,url}',body->>'cover_url',cover_url),source_url=coalesce(body->>'source_url',source_url),updated_at=now() where id=ident returning * into d;
   if body ? 'tags' then
    delete from public.document_tags where document_id=ident;
    foreach tag_name in array private.text_array(body->'tags') loop
     tag_name:=trim(tag_name); if tag_name='' then continue; end if;
     select id into tag_id from public.tags where id::text=tag_name;
     if tag_id is null then
      tag_slug:=private.slug(tag_name);
      if tag_slug='' then raise sqlstate '22023' using message='Invalid tag'; end if;
      insert into public.tags(name,slug) values(tag_name,tag_slug) on conflict(slug) do update set name=excluded.name returning id into tag_id;
     end if;
     insert into public.document_tags values(ident,tag_id) on conflict do nothing;
    end loop;
   end if;
  else raise sqlstate '22023' using message='Invalid article operation'; end if;
  if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
  return jsonb_build_object('document',private.document_json(d));
 end if;

 if parts[1]='admin' and method='GET' then
  perform private.require_admin();
  if path='/admin/stats' then
   return jsonb_build_object('totals',jsonb_build_object('documents',(select count(*) from public.documents),'categories',(select count(*) from public.categories),'tags',(select count(*) from public.tags),'searches',(select count(*) from public.search_logs where event='search'),'clicks',(select count(*) from public.search_logs where event='click')));
  elsif path='/admin/search-logs' then
   with filtered as (
    select * from public.search_logs where (coalesce(params->>'event','')='' or event=params->>'event')
     and (coalesce(params->>'q','')='' or position(lower(params->>'q') in lower(query_string))>0)
     and (coalesce(params->>'source','')='' or is_synthetic=(params->>'source'='synthetic'))
     and (coalesce(params->>'engine','')='' or engine=params->>'engine')
     and (coalesce(params->>'query_type','')='' or query_type=params->>'query_type')
   ) select coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('user_id',private.profile_json(x.user_id),'clicked_doc_id',(select jsonb_build_object('id',id,'title',title,'slug',slug) from public.documents where id=x.clicked_doc_id))) from (select * from filtered order by timestamp desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
   return jsonb_build_object('items',items,'total',n,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(n::numeric/page_size)));
  elsif path='/admin/search-engine' then
   -- image_embeddings only exists where pgvector is installed (migration 0002), so it is read dynamically.
   if to_regclass('public.image_embeddings') is not null then
    execute 'select coalesce(array_agg(distinct e.document_id),''{}'') from public.image_embeddings e join public.documents d on d.id=e.document_id and d.cover_url=e.image_url' into embedded_ids;
   end if;
   return jsonb_build_object(
    'total',(select count(*) from public.documents),
    'indexed',(select count(*) from public.documents d join public.search_index_status s on s.document_id=d.id where s.processed),
    'pending',(select count(*) from public.documents d where not exists(select 1 from public.search_index_status s where s.document_id=d.id and s.processed)),
    'images_embedded',(select count(*) from public.documents where coalesce(cover_url,'')<>'' and id=any(embedded_ids)),
    'images_expected',(select count(*) from public.documents where coalesce(cover_url,'')<>''),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'processed',x.processed,'has_image',x.has_image,'image_embedded',x.image_embedded,'last_error',x.last_error,'updated_at',x.updated_at)
      order by (x.last_error is not null) desc,x.processed,x.updated_at desc,x.id)
     from (select d.id,d.title,coalesce(s.processed,false) processed,coalesce(d.cover_url,'')<>'' has_image,(coalesce(d.cover_url,'')<>'' and d.id=any(embedded_ids)) image_embedded,s.last_error,coalesce(s.updated_at,d.updated_at) updated_at
      from public.documents d left join public.search_index_status s on s.document_id=d.id) x),'[]'));
  elsif path='/admin/export' then
   select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('tags',coalesce((select jsonb_agg(t.name order by t.name) from public.tags t join public.document_tags dt on dt.tag_id=t.id where dt.document_id=d.id),'[]')) order by d.created_at),'[]') into items from public.documents d;
   return jsonb_build_object('items',items);
  end if;
 end if;
 raise sqlstate 'P0002' using message='Route not found';
end $$;
