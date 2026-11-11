-- Course-project scope: Auth + documents + taxonomy + search/click dataset.
-- Snapshot the previous application before removing features. The archive is not exposed.
create schema archive;
revoke all on schema archive from public, anon, authenticated;
do $$ declare t text; begin
 foreach t in array array['profiles','categories','tags','documents','document_tags','comments','comment_mentions','likes','ratings','reports','settings','search_logs','interaction_logs','system_logs'] loop
 execute format('create table archive.%I as table public.%I',t,t);
 execute format('revoke all on archive.%I from public, anon, authenticated',t);
 end loop;
end $$;

drop function public.portal_api(text,text,jsonb,jsonb,text);
drop function private.list_documents(jsonb,boolean);
drop function private.document_json(public.documents,boolean);
drop function private.comment_json(public.comments);
drop function private.analytics(integer);
drop function private.audit(text,text,jsonb);
drop function private.require_permission(text);
drop function private.can(text);
drop function private.permissions(public.profiles);

create or replace function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,username,display_name)
 values(new.id,lower(trim(coalesce(new.raw_user_meta_data->>'username','user_'||substr(replace(new.id::text,'-',''),1,16)))),coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),new.raw_user_meta_data->>'username','Reader'));
 return new;
end $$;

-- No active business logic or foreign keys retain the removed social/analytics tables.
drop table public.reports, public.comment_mentions, public.likes, public.ratings, public.interaction_logs, public.system_logs;
drop table public.comments;
drop table public.settings;
drop table private.app_metadata;

alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role=case when role in ('super_admin','content_manager') then 'admin' else 'user' end;
alter table public.profiles add constraint profiles_role_check check(role in ('admin','user'));
alter table public.profiles drop column bio,drop column avatar_url,drop column permissions,drop column status,drop column is_muted;
alter table public.categories drop column description,drop column color;
alter table public.categories add constraint categories_name_not_empty check(trim(name)<>''),add constraint categories_slug_not_empty check(slug<>'');
alter table public.tags add constraint tags_name_not_empty check(trim(name)<>''),add constraint tags_slug_not_empty check(slug<>'');
alter table public.documents rename column canonical_url to source_url;
alter table public.documents drop column legacy_id,drop column status,drop column published_at,drop column cover_alt,drop column cover_caption,drop column meta_title,drop column meta_description,drop column keywords,drop column reading_time,drop column is_featured;
create index documents_created on public.documents(created_at desc);
alter table public.search_logs drop column filters;
alter table public.search_logs add column is_synthetic boolean not null default false;
update public.search_logs set is_synthetic=true where session_id like 'seed-%';

create function private.require_admin() returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise sqlstate '42501' using message='Admin access required'; end if;
end $$;
create or replace function private.profile_json(uid uuid, full_record boolean default false) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(p) || case when full_record then jsonb_build_object('email',(select email from auth.users where id=p.id)) else '{}'::jsonb end from public.profiles p where id=uid;
$$;
create function private.document_json(d public.documents, full_content boolean default true) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(d)-'cover_url') - case when full_content then array[]::text[] else array['content','content_text'] end
 || jsonb_build_object('category_id',(select to_jsonb(c) from public.categories c where id=d.category_id), 'author',private.profile_json(d.author),
 'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.tags t join public.document_tags dt on dt.tag_id=t.id where dt.document_id=d.id),'[]'),
 'cover_image',jsonb_build_object('url',d.cover_url));
$$;

create function private.list_documents(q jsonb) returns jsonb language plpgsql set search_path='' as $$
declare items jsonb; total integer; page_no integer:=greatest(1,coalesce((q->>'page')::int,1)); page_size integer:=least(50,greatest(1,coalesce((q->>'limit')::int,9)));
begin
 with filtered as (
  select d.* from public.documents d where
  (coalesce(q->>'category','')='' or exists(select 1 from public.categories c where c.id=d.category_id and (c.id::text=q->>'category' or c.slug=q->>'category')))
  and (coalesce(q->>'tag','')='' or exists(select 1 from public.document_tags dt join public.tags t on t.id=dt.tag_id where dt.document_id=d.id and (t.id::text=q->>'tag' or t.slug=q->>'tag')))
  and (coalesce(q->>'from','')='' or d.created_at>=(q->>'from')::date)
  and (coalesce(q->>'to','')='' or d.created_at<(q->>'to')::date+interval '1 day')
  and not exists(select 1 from regexp_split_to_table(left(trim(coalesce(q->>'q','')),200),E'\\s+') term where term<>'' and position(lower(term) in lower(d.title||' '||d.summary||' '||d.content_text))=0)
 ), paged as (
  select * from filtered order by
   case when q->>'sort'='popular' then views_count end desc,
   case when q->>'sort'='oldest' then created_at end asc,
   case when coalesce(q->>'sort','')<>'oldest' then created_at end desc,id
  offset (page_no-1)*page_size limit page_size
 ) select coalesce((select jsonb_agg(private.document_json(p,false)) from paged p),'[]'),(select count(*) from filtered) into items,total;
 return jsonb_build_object('items',items,'total',total,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(total::numeric/page_size)));
end $$;

create function public.portal_api(path text, method text default 'GET', body jsonb default '{}', params jsonb default '{}', session_id text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 uid uuid:=auth.uid(); parts text[]:=string_to_array(trim(both '/' from path),'/');
 d public.documents; ident uuid; items jsonb; result jsonb; n integer;
 page_no integer:=greatest(1,coalesce((params->>'page')::int,1)); page_size integer:=least(100,greatest(1,coalesce((params->>'limit')::int,30)));
 tag_name text; tag_slug text; tag_id uuid; base_slug text;
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
  insert into public.search_logs(user_id,query_string,clicked_doc_id,event,position,session_id)
   values(uid,left(trim(body->>'query_string'),300),(body->>'clicked_doc_id')::uuid,'click',(body->>'position')::integer,session_id);
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
   ) select coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('user_id',private.profile_json(x.user_id),'clicked_doc_id',(select jsonb_build_object('id',id,'title',title,'slug',slug) from public.documents where id=x.clicked_doc_id))) from (select * from filtered order by timestamp desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
   return jsonb_build_object('items',items,'total',n,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(n::numeric/page_size)));
  elsif path='/admin/export' then
   select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('tags',coalesce((select jsonb_agg(t.name order by t.name) from public.tags t join public.document_tags dt on dt.tag_id=t.id where dt.document_id=d.id),'[]')) order by d.created_at),'[]') into items from public.documents d;
   return jsonb_build_object('items',items);
  end if;
 end if;
 raise sqlstate 'P0002' using message='Route not found';
end $$;

revoke all on function public.portal_api(text,text,jsonb,jsonb,text) from public;
grant execute on function public.portal_api(text,text,jsonb,jsonb,text) to anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
-- Existing table RLS and denied direct browser access remain in place.
