-- Relational data; Auth owns credentials. Browser writes go through checked RPCs only.
create schema if not exists private;
revoke all on schema private from public;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
 display_name text not null check (length(display_name) between 1 and 60),
 bio text not null default '' check(length(bio)<=500), avatar_url text not null default '',
 role text not null default 'user' check(role in ('user','super_admin','content_manager','moderator','seo_specialist')),
 permissions text[] not null default '{}', status text not null default 'active' check(status in ('active','banned')),
 is_muted boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.categories(id uuid primary key default gen_random_uuid(), name varchar(60) not null, slug text not null unique, description varchar(300) not null default '', color text not null default '#b4232a', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.tags(id uuid primary key default gen_random_uuid(), name varchar(40) not null, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.documents(
 id uuid primary key default gen_random_uuid(), legacy_id text unique,
 title varchar(200) not null check(length(trim(title))>0), slug text not null unique,
 summary varchar(600) not null, content text not null, content_text text not null default '',
 category_id uuid not null references public.categories(id), author uuid not null references public.profiles(id),
 status text not null default 'draft' check(status in ('draft','published','archived')), published_at timestamptz,
 cover_url text not null default '', cover_alt text not null default '', cover_caption text not null default '',
 meta_title varchar(70) not null default '', meta_description varchar(170) not null default '', keywords text[] not null default '{}', canonical_url text not null default '',
 reading_time integer not null default 1, views_count integer not null default 0 check(views_count>=0), is_featured boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index documents_listing on public.documents(status,published_at desc);
create index documents_category on public.documents(category_id);
create index documents_author on public.documents(author);
create table public.document_tags(document_id uuid references public.documents(id) on delete cascade, tag_id uuid references public.tags(id) on delete cascade, primary key(document_id,tag_id));
create index document_tags_tag on public.document_tags(tag_id);
create table public.comments(
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade, parent_id uuid references public.comments(id) on delete cascade,
 content text not null check(length(trim(content)) between 1 and 2000),
 status text not null default 'visible' check(status in ('visible','pending','hidden','spam')),
 moderation_reason text not null default '', flags_count integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index comments_document on public.comments(document_id,status,created_at);
create index comments_user on public.comments(user_id);
create table public.comment_mentions(comment_id uuid references public.comments(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, primary key(comment_id,user_id));
create index comment_mentions_user on public.comment_mentions(user_id);
create table public.likes(user_id uuid references public.profiles(id) on delete cascade, document_id uuid references public.documents(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,document_id));
create index likes_document on public.likes(document_id);
create table public.ratings(user_id uuid references public.profiles(id) on delete cascade, document_id uuid references public.documents(id) on delete cascade, value integer not null check(value between 1 and 5), created_at timestamptz not null default now(), primary key(user_id,document_id));
create index ratings_document on public.ratings(document_id);
create table public.reports(
 id uuid primary key default gen_random_uuid(), document_id uuid references public.documents(id) on delete cascade, comment_id uuid references public.comments(id) on delete cascade,
 reporter_id uuid not null references public.profiles(id) on delete cascade,
 reason text not null check(reason in ('spam','abuse','misinformation','offensive','other')), details varchar(500) not null default '',
 status text not null default 'open' check(status in ('open','resolved','dismissed')), handled_by uuid references public.profiles(id) on delete set null, resolution_note text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(num_nonnulls(document_id,comment_id)=1)
);
create unique index reports_open_document on public.reports(reporter_id,document_id) where status='open';
create unique index reports_open_comment on public.reports(reporter_id,comment_id) where status='open';
create table public.settings(
 key text primary key default 'global' check(key='global'), site_name text not null default 'The Daily Lens', tagline text not null default 'Stories worth reading',
 items_per_page integer not null default 9 check(items_per_page between 3 and 50), allow_registration boolean not null default true,
 comment_policy text not null default 'open' check(comment_policy in ('open','approval')), banned_words text[] not null default '{}',
 max_links_per_comment integer not null default 2 check(max_links_per_comment between 0 and 20), auto_hide_flag_threshold integer not null default 3 check(auto_hide_flag_threshold between 1 and 50), footer_text text not null default ''
);
insert into public.settings default values;
create table public.search_logs(id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null, query_string varchar(300) not null check(length(trim(query_string))>0), clicked_doc_id uuid references public.documents(id) on delete set null, timestamp timestamptz not null default now(), session_id varchar(64) not null default '', event text not null check(event in ('search','click')), results_count integer, position integer, filters jsonb not null default '{}');
create index search_logs_time on public.search_logs(timestamp);
create table public.interaction_logs(id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null, doc_id uuid not null references public.documents(id) on delete cascade, session_id varchar(64) not null default '', action text not null check(action in ('view','like','unlike','rate','comment')), value integer, timestamp timestamptz not null default now());
create index interaction_logs_time on public.interaction_logs(timestamp,action);
create table public.system_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, actor_name text not null default 'system', level text not null default 'info', action text not null, target_type text not null default '', target_id text not null default '', details jsonb not null default '{}', timestamp timestamptz not null default now());

create function private.permissions(p public.profiles) returns text[] language sql immutable set search_path='' as $$
 select array(select distinct unnest(coalesce(p.permissions,'{}') || case p.role
 when 'super_admin' then array['users:manage','logs:view','settings:manage','content:manage','content:publish','taxonomy:manage','comments:moderate','reports:handle','seo:manage','analytics:view']
 when 'content_manager' then array['content:manage','content:publish','taxonomy:manage'] when 'moderator' then array['comments:moderate','reports:handle'] when 'seo_specialist' then array['seo:manage','analytics:view'] else '{}'::text[] end));
$$;
create function private.can(perm text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where id=auth.uid() and status='active' and perm=any(private.permissions(p)));
$$;
create function private.require_permission(perm text) returns void language plpgsql set search_path='' as $$
 begin if not private.can(perm) then raise sqlstate '42501' using message='Permission denied'; end if; end $$;
create function private.profile_json(uid uuid, full_record boolean default false) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(p) - 'permissions' - 'status') || case when full_record then jsonb_build_object('permissions',p.permissions,'status',p.status,'email',(select email from auth.users where id=p.id),'effective_permissions',private.permissions(p)) else '{}'::jsonb end from public.profiles p where id=uid;
$$;
create function private.audit(action_name text,target text default '', payload jsonb default '{}') returns void language sql set search_path='' as $$
 insert into public.system_logs(actor_id,actor_name,action,target_id,details) select auth.uid(),coalesce((select username from public.profiles where id=auth.uid()),'anonymous'),action_name,target,payload;
$$;
create function private.document_json(d public.documents, full_content boolean default true) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(d)-'cover_url'-'cover_alt'-'cover_caption'-'meta_title'-'meta_description'-'keywords'-'canonical_url')
 - case when full_content then array[]::text[] else array['content','content_text'] end
 || jsonb_build_object('category_id',(select to_jsonb(c) from public.categories c where id=d.category_id), 'author',private.profile_json(d.author),
 'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.tags t join public.document_tags dt on dt.tag_id=t.id where dt.document_id=d.id),'[]'),
 'cover_image',jsonb_build_object('url',d.cover_url,'alt',d.cover_alt,'caption',d.cover_caption),
 'seo',jsonb_build_object('meta_title',d.meta_title,'meta_description',d.meta_description,'keywords',d.keywords,'canonical_url',d.canonical_url),
 'likes_count',(select count(*) from public.likes where document_id=d.id), 'comments_count',(select count(*) from public.comments where document_id=d.id and status='visible'),
 'rating_count',(select count(*) from public.ratings where document_id=d.id), 'rating_avg',coalesce((select round(avg(value),1) from public.ratings where document_id=d.id),0));
$$;
create function private.comment_json(c public.comments) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('user_id',private.profile_json(c.user_id), 'document_id',(select jsonb_build_object('id',id,'title',title,'slug',slug) from public.documents where id=c.document_id),
 'mentions',coalesce((select jsonb_agg(private.profile_json(m.user_id)) from public.comment_mentions m where comment_id=c.id),'[]'));
$$;
create function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if not (select allow_registration from public.settings where key='global') and coalesce(new.raw_app_meta_data->>'admin_created','false')<>'true' then raise exception 'Registration is currently disabled'; end if;
 insert into public.profiles(id,username,display_name) values(new.id,lower(trim(coalesce(new.raw_user_meta_data->>'username','user_'||substr(replace(new.id::text,'-',''),1,16)))),coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),new.raw_user_meta_data->>'username','Reader'));
 return new;
 end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.new_user();

-- No browser role can write tables, even when a caller bypasses the UI.
-- RPCs check identity, roles, allowed fields and parent/child relationships before writing.
do $$ declare t text; begin
 foreach t in array array['profiles','categories','tags','documents','document_tags','comments','comment_mentions','likes','ratings','reports','settings','search_logs','interaction_logs','system_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop; end $$;
-- Curated reads use the RPC too, so profile emails/settings and drafts cannot leak via joins.
revoke all on all functions in schema private from public, anon, authenticated;
