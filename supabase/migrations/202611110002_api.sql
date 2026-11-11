create function private.list_documents(q jsonb, managed boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; total integer; page_no integer:=greatest(1,coalesce((q->>'page')::int,1)); page_size integer:=least(50,greatest(1,coalesce((q->>'limit')::int,(select items_per_page from public.settings where key='global'))));
begin
 with filtered as (
 select d.* from public.documents d where
 (case when managed then (coalesce(q->>'status','')='' or d.status=q->>'status') else d.status='published' end)
 and (coalesce(q->>'featured','')<>'true' or d.is_featured)
 and (coalesce(q->>'category','')='' or exists(select 1 from public.categories c where c.id=d.category_id and (c.id::text=q->>'category' or c.slug=q->>'category')))
 and (coalesce(q->>'tag','')='' or exists(select 1 from public.document_tags dt join public.tags t on t.id=dt.tag_id where dt.document_id=d.id and (t.id::text=q->>'tag' or t.slug=q->>'tag')))
 and (coalesce(q->>'author','')='' or d.author::text=q->>'author')
 and (coalesce(q->>'from','')='' or coalesce(d.published_at,d.created_at)>=(q->>'from')::date)
 and (coalesce(q->>'to','')='' or coalesce(d.published_at,d.created_at)<(q->>'to')::date+interval '1 day')
 and (coalesce(q->>'seo','')<>'missing' or d.meta_title='' or d.meta_description='' or d.cover_alt='')
 and not exists(select 1 from regexp_split_to_table(trim(coalesce(q->>'q','')),E'\\s+') term where term<>'' and position(lower(term) in lower(d.title||' '||d.summary||' '||d.content_text))=0)
 ), paged as (
 select * from filtered order by
 case when q->>'sort'='popular' then views_count end desc,
 case when q->>'sort'='top_rated' then (select avg(value) from public.ratings where document_id=filtered.id) end desc nulls last,
 case when q->>'sort'='oldest' then coalesce(published_at,created_at) end asc,
 case when coalesce(q->>'sort','')<>'oldest' then coalesce(published_at,updated_at) end desc,id
 offset (page_no-1)*page_size limit page_size
 ) select coalesce((select jsonb_agg(private.document_json(p,false)) from paged p),'[]'),(select count(*) from filtered) into result,total;
 return jsonb_build_object('items',result,'total',total,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(total::numeric/page_size)));
end $$;

create function private.analytics(days integer) returns jsonb language sql stable set search_path='' as $$
 with searches as (select * from public.search_logs where timestamp>=date_trunc('day',now())-(days-1)*interval '1 day'),
 queries as (select lower(query_string) query,count(*) filter(where event='search') searches,count(*) filter(where event='click') clicks from searches group by lower(query_string)),
 daily as (select d::date::text date,(select count(*) from public.interaction_logs i where action='view' and i.timestamp>=d and i.timestamp<d+interval '1 day') views from generate_series(date_trunc('day',now())-(days-1)*interval '1 day',date_trunc('day',now()),interval '1 day') d),
 categories as (select c.name,c.color,count(d.id) articles,coalesce(sum(d.views_count),0) views from public.categories c join public.documents d on d.category_id=c.id and d.status='published' group by c.id),
 top_docs as (select * from public.documents where status='published' order by views_count desc limit 10),
 top_q as (select *,round(clicks*100.0/nullif(searches,0),1) ctr from queries where searches>0 order by searches desc limit 10),
 zero_q as (select lower(query_string) query,count(*) count from searches where event='search' and results_count=0 group by lower(query_string) order by count(*) desc limit 10)
 select jsonb_build_object('range_days',days,
 'totals',jsonb_build_object('published',(select count(*) from public.documents where status='published'),'views',(select coalesce(sum(views_count),0) from public.documents),'users',(select count(*) from public.profiles),'comments',(select count(*) from public.comments where status='visible'),'likes',(select count(*) from public.likes),'searches',(select count(*) from searches where event='search'),'clicks',(select count(*) from searches where event='click'),'ctr',coalesce((select round(count(*) filter(where event='click')*100.0/nullif(count(*) filter(where event='search'),0),1) from searches),0)),
 'daily_views',(select jsonb_agg(to_jsonb(daily)) from daily),'by_category',coalesce((select jsonb_agg(to_jsonb(categories) order by views desc) from categories),'[]'),
 'top_documents',coalesce((select jsonb_agg(private.document_json(d,false)) from top_docs d),'[]'), 'top_queries',coalesce((select jsonb_agg(to_jsonb(top_q)) from top_q),'[]'),'zero_result_queries',coalesce((select jsonb_agg(to_jsonb(zero_q)) from zero_q),'[]'),
 'seo_missing',(select jsonb_build_object('meta_title',count(*) filter(where meta_title=''),'meta_description',count(*) filter(where meta_description=''),'keywords',count(*) filter(where cardinality(keywords)=0),'cover_alt',count(*) filter(where cover_alt='')) from public.documents where status='published'));
$$;

create function public.portal_api(path text, method text default 'GET', body jsonb default '{}', params jsonb default '{}', session_id text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
 uid uuid:=auth.uid(); me public.profiles; d public.documents; c public.comments; r public.reports; s public.settings; p public.profiles;
 parts text[]:=string_to_array(trim(both '/' from path),'/'); ident uuid; result jsonb; items jsonb; n integer; amount integer; found_like boolean;
 page_no integer:=greatest(1,coalesce((params->>'page')::int,1)); page_size integer:=least(100,greatest(1,coalesce((params->>'limit')::int,20)));
 tag_name text; tag_slug text; tag_id uuid; target_status text; parent uuid; comment_status text; reason_text text:=''; ids uuid[]; perm text;
begin
 body:=coalesce(body,'{}'); params:=coalesce(params,'{}'); session_id:=left(coalesce(session_id,''),64);
 select * into me from public.profiles where id=uid;
 select * into s from public.settings where key='global';
 if uid is not null and (me.id is null or me.status<>'active') then raise sqlstate '42501' using message='Account is suspended or unavailable'; end if;
 if method not in ('GET','POST','PUT','PATCH','DELETE') then raise sqlstate '22023' using message='Invalid method'; end if;
 -- All non-public mutations require an active Auth user.
 if method<>'GET' and uid is null and path<>'/search/click' then raise sqlstate '42501' using message='Authentication required'; end if;

 if parts[1]='seo' and method='GET' then
  if parts[2]='sitemap' then return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('slug',slug,'updated_at',updated_at)) from public.documents where status='published'),'[]')); end if;
  if parts[2]='article' then
   select * into d from public.documents where status='published' and slug=parts[3];
   if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
   return jsonb_build_object('document',private.document_json(d,false));
  end if;
 end if;
 if path='/auth/me' then
  if uid is null then raise sqlstate '42501' using message='Authentication required'; end if;
  if method='PUT' then
   update public.profiles set display_name=coalesce(body->>'display_name',display_name),bio=coalesce(body->>'bio',bio),avatar_url=coalesce(body->>'avatar_url',avatar_url),updated_at=now() where id=uid;
  elsif method<>'GET' then raise sqlstate '22023' using message='Invalid method'; end if;
  return jsonb_build_object('user',private.profile_json(uid,true));
 end if;
 if path='/settings/public' and method='GET' then return jsonb_build_object('settings',to_jsonb(s)-'banned_words'-'max_links_per_comment'-'auto_hide_flag_threshold'); end if;
 if path='/analytics/overview' and method='GET' then perform private.require_permission('analytics:view'); return private.analytics(least(365,greatest(7,coalesce((params->>'days')::int,30)))); end if;

 -- Taxonomy mutations are restricted; category reassignment is atomic.
 if parts[1] in ('categories','tags') then
  if method='GET' then
   if parts[1]='categories' then select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('count',(select count(*) from public.documents where category_id=t.id and status='published')) order by name),'[]') into items from public.categories t;
   else select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('count',(select count(*) from public.document_tags dt join public.documents d on d.id=dt.document_id where dt.tag_id=t.id and d.status='published')) order by name),'[]') into items from public.tags t; end if;
   return jsonb_build_object('items',items);
  end if;
  perform private.require_permission('taxonomy:manage');
  if parts[2] is not null then ident:=parts[2]::uuid; end if;
  tag_slug:=coalesce(nullif(body->>'slug',''),private.slug(body->>'name'));
  if parts[1]='categories' then
   if method='POST' then insert into public.categories(name,slug,description,color) values(body->>'name',tag_slug,coalesce(body->>'description',''),coalesce(body->>'color','#b4232a')) returning id into ident;
   elsif method='PUT' then update public.categories set name=coalesce(body->>'name',name),slug=coalesce(nullif(body->>'slug',''),slug),description=coalesce(body->>'description',description),color=coalesce(body->>'color',color),updated_at=now() where id=ident;
   elsif method='DELETE' then
    if exists(select 1 from public.documents where category_id=ident) then
     if params->>'reassign_to' is null or (params->>'reassign_to')::uuid=ident then raise sqlstate '22023' using message='Choose another category to move articles to'; end if;
     update public.documents set category_id=(params->>'reassign_to')::uuid where category_id=ident;
    end if;
    delete from public.categories where id=ident;
   else raise sqlstate '22023' using message='Invalid method'; end if;
   select to_jsonb(t) into result from public.categories t where id=ident;
  else
   if method='POST' then insert into public.tags(name,slug) values(body->>'name',tag_slug) returning id into ident;
   elsif method='PUT' then update public.tags set name=coalesce(body->>'name',name),slug=coalesce(tag_slug,slug),updated_at=now() where id=ident;
   elsif method='DELETE' then delete from public.tags where id=ident;
   else raise sqlstate '22023' using message='Invalid method'; end if;
   select to_jsonb(t) into result from public.tags t where id=ident;
  end if;
  perform private.audit(parts[1]||'.'||lower(method),ident::text,body);
  return jsonb_build_object(case when method='DELETE' then 'ok' when parts[1]='categories' then 'category' else 'tag' end,case when method='DELETE' then 'true'::jsonb else result end);
 end if;

 if parts[1]='documents' then
  if parts[2] is null and method='GET' then
   result:=private.list_documents(params);
   if coalesce(trim(params->>'q'),'')<>'' and page_no=1 and coalesce(params->>'log','')<>'false' then
    insert into public.search_logs(user_id,query_string,event,results_count,filters,session_id) values(uid,left(trim(params->>'q'),300),'search',(result->>'total')::int,params,session_id);
   end if;
   return result;
  end if;
  select * into d from public.documents where status='published' and (slug=parts[2] or id::text=parts[2]);
  if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
  ident:=d.id;
  if parts[3] is null and method='GET' then
   update public.documents set views_count=views_count+1 where id=ident returning * into d;
   insert into public.interaction_logs(user_id,doc_id,action,session_id) values(uid,ident,'view',session_id);
   select coalesce(jsonb_agg(private.document_json(x,false)),'[]') into items from (select * from public.documents where category_id=d.category_id and id<>ident and status='published' order by published_at desc limit 4) x;
   return jsonb_build_object('document',private.document_json(d),'related',items,'viewer',jsonb_build_object('liked',exists(select 1 from public.likes where user_id=uid and document_id=ident),'rating',coalesce((select value from public.ratings where user_id=uid and document_id=ident),0)));
  elsif parts[3]='like' and method='POST' then
   -- Serialize toggles on the article; counters are derived instead of cached.
   perform 1 from public.documents where id=ident for update;
   delete from public.likes where user_id=uid and document_id=ident; found_like:=found;
   if not found_like then insert into public.likes(user_id,document_id) values(uid,ident); end if;
   insert into public.interaction_logs(user_id,doc_id,action,session_id) values(uid,ident,case when found_like then 'unlike' else 'like' end,session_id);
   return jsonb_build_object('liked',not found_like,'likes_count',(select count(*) from public.likes where document_id=ident));
  elsif parts[3]='rate' and method='POST' then
   amount:=(body->>'value')::integer;
   if amount is null or amount<1 or amount>5 or (body->>'value')::numeric<>amount then raise sqlstate '22023' using message='Rating must be an integer from 1 to 5'; end if;
   insert into public.ratings(user_id,document_id,value) values(uid,ident,amount) on conflict(user_id,document_id) do update set value=excluded.value;
   insert into public.interaction_logs(user_id,doc_id,action,value,session_id) values(uid,ident,'rate',amount,session_id);
   return jsonb_build_object('rating',amount,'rating_count',(select count(*) from public.ratings where document_id=ident),'rating_avg',(select round(avg(value),1) from public.ratings where document_id=ident));
  elsif parts[3]='comments' then
   if method='GET' then
    select coalesce(jsonb_agg(private.comment_json(x) order by x.created_at),'[]') into items from (select * from public.comments where document_id=ident and (status='visible' or (user_id=uid and status='pending')) order by created_at limit 500) x;
    return jsonb_build_object('items',items);
   elsif method='POST' then
    if me.is_muted then raise sqlstate '42501' using message='Your account is muted'; end if;
    if body->>'parent_id' is not null then
     select * into c from public.comments where id=(body->>'parent_id')::uuid and document_id=ident and (status='visible' or user_id=uid);
     if c.id is null then raise sqlstate '22023' using message='Parent comment not found'; end if;
     parent:=coalesce(c.parent_id,c.id);
    end if;
    comment_status:=case when s.comment_policy='approval' then 'pending' else 'visible' end;
    if exists(select 1 from unnest(s.banned_words) w where w<>'' and position(lower(w) in lower(body->>'content'))>0) then comment_status:='pending'; reason_text:='Contains blocked word'; end if;
    if (select count(*) from regexp_matches(coalesce(body->>'content',''),'https?://','gi'))>s.max_links_per_comment then comment_status:='spam'; reason_text:='Too many links'; end if;
    insert into public.comments(document_id,user_id,parent_id,content,status,moderation_reason) values(ident,uid,parent,trim(body->>'content'),comment_status,reason_text) returning * into c;
    insert into public.comment_mentions(comment_id,user_id) select c.id,p.id from public.profiles p where p.username in (select lower(m[1]) from regexp_matches(c.content,'@([a-zA-Z0-9_]{3,30})','g') m);
    insert into public.interaction_logs(user_id,doc_id,action,session_id) values(uid,ident,'comment',session_id);
    return jsonb_build_object('comment',private.comment_json(c));
   end if;
  end if;
 end if;

 if parts[1]='comments' and method='DELETE' then
  select * into c from public.comments where id=parts[2]::uuid;
  if c.id is null then raise sqlstate 'P0002' using message='Comment not found'; end if;
  if c.user_id<>uid then perform private.require_permission('comments:moderate'); end if;
  delete from public.comments where id=c.id;
  return jsonb_build_object('ok',true);
 end if;
 if path='/reports' and method='POST' then
  if body->>'target_type'='comment' then
   select * into c from public.comments where id=(body->>'target_id')::uuid and status='visible' and exists(select 1 from public.documents where id=comments.document_id and status='published');
   if c.id is null then raise sqlstate 'P0002' using message='Reported comment not found'; end if;
   perform 1 from public.comments where id=c.id for update;
   insert into public.reports(comment_id,reporter_id,reason,details) values(c.id,uid,body->>'reason',coalesce(body->>'details','')) returning * into r;
   update public.comments set flags_count=flags_count+1,
    status=case when flags_count+1>=s.auto_hide_flag_threshold and status='visible' then 'pending' else status end,
    moderation_reason=case when flags_count+1>=s.auto_hide_flag_threshold then 'Auto-hidden after reports' else moderation_reason end where id=c.id;
  elsif body->>'target_type'='document' then
   if not exists(select 1 from public.documents where id=(body->>'target_id')::uuid and status='published') then raise sqlstate 'P0002' using message='Article not found'; end if;
   insert into public.reports(document_id,reporter_id,reason,details) values((body->>'target_id')::uuid,uid,body->>'reason',coalesce(body->>'details','')) returning * into r;
  else raise sqlstate '22023' using message='Invalid target type'; end if;
  return jsonb_build_object('report',to_jsonb(r));
 end if;
 if path='/search/click' and method='POST' then
  if not exists(select 1 from public.documents where id=(body->>'clicked_doc_id')::uuid and status='published') then raise sqlstate 'P0002' using message='Article not found'; end if;
  insert into public.search_logs(user_id,query_string,clicked_doc_id,event,position,session_id) values(uid,left(trim(body->>'query_string'),300),(body->>'clicked_doc_id')::uuid,'click',(body->>'position')::integer,session_id);
  return jsonb_build_object('ok',true);
 end if;
 if parts[1]='users' and method='GET' then
  if parts[2]='lookup' then
   if uid is null then raise sqlstate '42501' using message='Authentication required'; end if;
   select coalesce(jsonb_agg(private.profile_json(x.id)),'[]') into items from (select id from public.profiles where status='active' and coalesce(params->>'q','')<>'' and (starts_with(lower(username),lower(params->>'q')) or starts_with(lower(display_name),lower(params->>'q'))) limit 8) x;
   return jsonb_build_object('items',items);
  end if;
  select * into p from public.profiles where username=lower(parts[2]);
  if p.id is null then raise sqlstate 'P0002' using message='User not found'; end if;
  return jsonb_build_object('user',private.profile_json(p.id),'stats',jsonb_build_object('comments',(select count(*) from public.comments where user_id=p.id and status='visible'),'articles',(select count(*) from public.documents where author=p.id and status='published')),
   'comments',coalesce((select jsonb_agg(private.comment_json(x)) from (select c.* from public.comments c join public.documents d on d.id=c.document_id where c.user_id=p.id and (c.status='visible' or p.id=uid) and d.status='published' order by c.created_at desc limit 20) x),'[]'),
   'mentions',coalesce((select jsonb_agg(private.comment_json(x)) from (select c.* from public.comments c join public.comment_mentions m on m.comment_id=c.id join public.documents d on d.id=c.document_id where m.user_id=p.id and c.status='visible' and d.status='published' order by c.created_at desc limit 10) x),'[]'),
   'articles',(private.list_documents(jsonb_build_object('author',p.id,'limit',6)))->'items');
 end if;
 if parts[1]='manage' and parts[2]='documents' then
  if method='GET' then
   if not (private.can('content:manage') or private.can('seo:manage')) then raise sqlstate '42501' using message='Permission denied'; end if;
   if parts[3] is null then return private.list_documents(params,true); end if;
   select * into d from public.documents where id=parts[3]::uuid;
   if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
   return jsonb_build_object('document',private.document_json(d));
  end if;
  if parts[4]='seo' then
   perform private.require_permission('seo:manage');
   body:=case when body ? 'seo' then (body->'seo')||jsonb_build_object('cover_alt',body->'cover_alt') else body end;
   update public.documents set meta_title=coalesce(body->>'meta_title',meta_title),meta_description=coalesce(body->>'meta_description',meta_description),
    keywords=case when body ? 'keywords' then private.text_array(body->'keywords') else keywords end,canonical_url=coalesce(body->>'canonical_url',canonical_url),cover_alt=coalesce(body->>'cover_alt',cover_alt),updated_at=now() where id=parts[3]::uuid returning * into d;
  elsif parts[4]='status' then
   perform private.require_permission('content:publish');
   update public.documents set status=body->>'status',published_at=case when body->>'status'='published' then coalesce(published_at,now()) else published_at end,updated_at=now() where id=parts[3]::uuid returning * into d;
  else
   perform private.require_permission('content:manage');
   if method='POST' then
    ident:=gen_random_uuid();
    d.id:=ident; d.author:=uid; d.status:='draft';
   else
    select * into d from public.documents where id=parts[3]::uuid for update;
    if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
    ident:=d.id;
   end if;
   if method='DELETE' then delete from public.documents where id=ident; perform private.audit('document.delete',ident::text); return jsonb_build_object('ok',true); end if;
   if method not in ('POST','PUT') then raise sqlstate '22023' using message='Invalid method'; end if;
   target_status:=coalesce(body->>'status',d.status);
   if target_status<>d.status and (target_status='published' or d.status='published') then perform private.require_permission('content:publish'); end if;
   tag_slug:=coalesce(nullif(body->>'slug',''),d.slug,private.slug(body->>'title'));
   if method='POST' or coalesce((body->>'regenerate_slug')::boolean,false) then
    tag_slug:=private.slug(coalesce(body->>'slug',body->>'title')); tag_name:=tag_slug; n:=2;
    while exists(select 1 from public.documents where slug=tag_slug and id<>ident) loop tag_slug:=tag_name||'-'||n; n:=n+1; end loop;
   end if;
   if method='POST' then
    insert into public.documents(id,title,slug,summary,content,category_id,author) values(ident,body->>'title',tag_slug,body->>'summary',body->>'content',(body->>'category_id')::uuid,uid);
   end if;
   update public.documents set title=coalesce(body->>'title',title),slug=tag_slug,summary=coalesce(body->>'summary',summary),content=coalesce(body->>'content',content),
    content_text=case when body ? 'content' then regexp_replace(body->>'content','<[^>]*>',' ','g') else content_text end,
    reading_time=case when body ? 'content' then greatest(1,ceil(cardinality(regexp_split_to_array(regexp_replace(body->>'content','<[^>]*>',' ','g'),E'\\s+'))/220.0)) else reading_time end,
    category_id=coalesce((body->>'category_id')::uuid,category_id),status=target_status,published_at=case when target_status='published' then coalesce(published_at,now()) else published_at end,
    is_featured=coalesce((body->>'is_featured')::boolean,is_featured),cover_url=coalesce(body#>>'{cover_image,url}',cover_url),cover_alt=coalesce(body#>>'{cover_image,alt}',cover_alt),cover_caption=coalesce(body#>>'{cover_image,caption}',cover_caption),updated_at=now() where id=ident returning * into d;
   if body ? 'tags' then
    delete from public.document_tags where document_id=ident;
    foreach tag_name in array private.text_array(body->'tags') loop
     if length(trim(tag_name))=0 then continue; end if;
     select id into tag_id from public.tags where id::text=tag_name;
     if tag_id is null then
      insert into public.tags(name,slug) values(trim(tag_name),private.slug(tag_name)) on conflict(slug) do update set name=excluded.name returning id into tag_id;
     end if;
     insert into public.document_tags values(ident,tag_id) on conflict do nothing;
    end loop;
   end if;
  end if;
  if d.id is null then raise sqlstate 'P0002' using message='Article not found'; end if;
  perform private.audit('document.'||lower(method),d.id::text);
  return jsonb_build_object('document',private.document_json(d));
 end if;

 if parts[1]='moderation' then
  if parts[2]='stats' and method='GET' then
   if not (private.can('comments:moderate') or private.can('reports:handle')) then raise sqlstate '42501' using message='Permission denied'; end if;
   return jsonb_build_object('comments',(select jsonb_object_agg(st,(select count(*) from public.comments where status=st)) from unnest(array['visible','pending','hidden','spam']) st),'open_reports',(select count(*) from public.reports where status='open'),'muted_users',(select count(*) from public.profiles where is_muted));
  elsif parts[2]='comments' then
   perform private.require_permission('comments:moderate');
   if method='GET' then
    with filtered as (select * from public.comments where (coalesce(params->>'status','')='' or status=params->>'status') and (coalesce(params->>'q','')='' or position(lower(params->>'q') in lower(content))>0) and (coalesce(params->>'flagged','')<>'true' or flags_count>0))
    select coalesce((select jsonb_agg(private.comment_json(x)) from (select * from filtered order by created_at desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
   else
    if parts[3]='bulk' then ids:=array(select jsonb_array_elements_text(body->'ids')::uuid); else ids:=array[parts[3]::uuid]; end if;
    if method='DELETE' then delete from public.comments where id=any(ids); get diagnostics n=row_count;
    elsif method in ('PATCH','POST') then update public.comments set status=body->>'status',moderation_reason='Set by '||me.username,updated_at=now() where id=any(ids); get diagnostics n=row_count;
    else raise sqlstate '22023' using message='Invalid method'; end if;
    perform private.audit('comment.moderate',coalesce(parts[3],''),body); return jsonb_build_object('ok',true,'updated',n);
   end if;
  elsif parts[2]='users' and parts[4]='mute' and method='PATCH' then
   perform private.require_permission('comments:moderate');
   update public.profiles set is_muted=(body->>'is_muted')::boolean where id=parts[3]::uuid and role='user' returning * into p;
   if p.id is null then raise sqlstate '22023' using message='Only reader accounts can be muted'; end if;
   perform private.audit('user.mute',p.id::text,body); return jsonb_build_object('user',private.profile_json(p.id));
  elsif parts[2]='reports' then
   perform private.require_permission('reports:handle');
   if method='GET' then
    with filtered as (select * from public.reports where coalesce(params->>'status','')='' or status=params->>'status')
    select coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('target_type',case when x.comment_id is null then 'document' else 'comment' end,'target_id',coalesce(x.comment_id,x.document_id),'reporter_id',private.profile_json(x.reporter_id),'handled_by',private.profile_json(x.handled_by),'target',case when x.comment_id is not null then (select private.comment_json(cc) from public.comments cc where id=x.comment_id) else (select private.document_json(dd,false) from public.documents dd where id=x.document_id) end)) from (select * from filtered order by created_at desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
   elsif method='PATCH' then
    select * into r from public.reports where id=parts[3]::uuid;
    if r.id is null then raise sqlstate 'P0002' using message='Report not found'; end if;
    if body->>'action'='hide_target' then
     update public.comments set status='hidden',moderation_reason='Hidden after report' where id=r.comment_id;
    elsif body->>'action'='mute_author' then
     update public.profiles set is_muted=true where id=(select user_id from public.comments where id=r.comment_id) and role='user';
    end if;
    update public.reports set status=body->>'status',resolution_note=coalesce(body->>'resolution_note',''),handled_by=uid,updated_at=now() where id=r.id returning * into r;
    perform private.audit('report.handle',r.id::text,body); return jsonb_build_object('report',to_jsonb(r));
   end if;
  end if;
  if items is not null then return jsonb_build_object('items',items,'total',n,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(n::numeric/page_size))); end if;
 end if;

 if parts[1]='admin' then
  if uid is null then raise sqlstate '42501' using message='Authentication required'; end if;
  if parts[2]='meta' and method='GET' then return (select value from private.app_metadata where key='roles'); end if;
  if parts[2]='settings' then
   perform private.require_permission('settings:manage');
   if method='PUT' then
    update public.settings set site_name=coalesce(body->>'site_name',site_name),tagline=coalesce(body->>'tagline',tagline),items_per_page=coalesce((body->>'items_per_page')::int,items_per_page),allow_registration=coalesce((body->>'allow_registration')::boolean,allow_registration),comment_policy=coalesce(body->>'comment_policy',comment_policy),banned_words=case when body ? 'banned_words' then private.text_array(body->'banned_words') else banned_words end,max_links_per_comment=coalesce((body->>'max_links_per_comment')::int,max_links_per_comment),auto_hide_flag_threshold=coalesce((body->>'auto_hide_flag_threshold')::int,auto_hide_flag_threshold),footer_text=coalesce(body->>'footer_text',footer_text) where key='global' returning * into s;
    perform private.audit('settings.update');
   elsif method<>'GET' then raise sqlstate '22023' using message='Invalid method'; end if;
   return jsonb_build_object('settings',to_jsonb(s));
  elsif parts[2]='users' then
   perform private.require_permission('users:manage');
   if method='GET' then
    with filtered as (select p.* from public.profiles p join auth.users u on u.id=p.id where (coalesce(params->>'role','')='' or p.role=params->>'role') and (coalesce(params->>'status','')='' or p.status=params->>'status') and (coalesce(params->>'q','')='' or position(lower(params->>'q') in lower(p.username||' '||p.display_name||' '||u.email))>0))
    select coalesce((select jsonb_agg(private.profile_json(x.id,true)) from (select * from filtered order by created_at desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
   elsif method='DELETE' and parts[4]='delete-check' then
    ident:=parts[3]::uuid;
    if ident=uid then raise sqlstate '22023' using message='You cannot delete your own account'; end if;
    if exists(select 1 from public.documents where author=ident) then raise sqlstate '22023' using message='Suspend authors instead of deleting them'; end if;
    perform private.audit('user.delete',ident::text);
    return jsonb_build_object('ok',true);
   elsif method='PATCH' then
    ident:=parts[3]::uuid;
    if ident=uid and ((body ? 'role' and body->>'role'<>me.role) or (body ? 'status' and body->>'status'<>'active') or body ? 'permissions') then raise sqlstate '22023' using message='You cannot change your own access'; end if;
    if body ? 'permissions' and exists(select 1 from unnest(private.text_array(body->'permissions')) val where not val=any(array['users:manage','logs:view','settings:manage','content:manage','content:publish','taxonomy:manage','comments:moderate','reports:handle','seo:manage','analytics:view'])) then raise sqlstate '22023' using message='Invalid permission'; end if;
    update public.profiles set role=coalesce(body->>'role',role),permissions=case when body ? 'permissions' then private.text_array(body->'permissions') else permissions end,status=coalesce(body->>'status',status),is_muted=coalesce((body->>'is_muted')::boolean,is_muted),display_name=coalesce(body->>'display_name',display_name),updated_at=now() where id=ident;
    if not found then raise sqlstate 'P0002' using message='User not found'; end if;
    perform private.audit('user.update',ident::text,body-'password'); return jsonb_build_object('user',private.profile_json(ident,true));
   end if;
  elsif parts[2]='logs' and method='GET' then
   perform private.require_permission('logs:view');
   with filtered as (select * from public.system_logs where (coalesce(params->>'level','')='' or level=params->>'level') and (coalesce(params->>'action','')='' or starts_with(lower(action),lower(params->>'action'))) and (coalesce(params->>'actor','')='' or actor_name=params->>'actor'))
   select coalesce((select jsonb_agg(to_jsonb(x)) from (select * from filtered order by timestamp desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
  elsif parts[2]='search-logs' and method='GET' then
   if not (private.can('logs:view') or private.can('analytics:view')) then raise sqlstate '42501' using message='Permission denied'; end if;
   with filtered as (select * from public.search_logs where (coalesce(params->>'event','')='' or event=params->>'event') and (coalesce(params->>'q','')='' or position(lower(params->>'q') in lower(query_string))>0))
   select coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('user_id',private.profile_json(x.user_id),'clicked_doc_id',(select jsonb_build_object('id',id,'title',title,'slug',slug) from public.documents where id=x.clicked_doc_id))) from (select * from filtered order by timestamp desc offset (page_no-1)*page_size limit page_size) x),'[]'),(select count(*) from filtered) into items,n;
  end if;
  if items is not null then return jsonb_build_object('items',items,'total',n,'page',page_no,'limit',page_size,'pages',greatest(1,ceil(n::numeric/page_size))); end if;
 end if;
 raise sqlstate 'P0002' using message='Route not found';
end $$;

create function private.slug(value text) returns text language sql immutable set search_path='' as $$ select trim(both '-' from regexp_replace(translate(lower(coalesce(value,'')),'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ','aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),'[^a-z0-9]+','-','g')); $$;
create function private.text_array(value jsonb) returns text[] language sql immutable set search_path='' as $$ select case when jsonb_typeof(value)='array' then array(select jsonb_array_elements_text(value)) else string_to_array(coalesce(value#>>'{}',''),',') end; $$;
create table private.app_metadata(key text primary key,value jsonb not null);
revoke all on function public.portal_api(text,text,jsonb,jsonb,text) from public;
grant execute on function public.portal_api(text,text,jsonb,jsonb,text) to anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
