-- Search engine, part 1: indexing queue and search-log columns.
-- New objects only. The one existing table touched is search_logs, which gains two
-- defaulted columns and a relaxed query_string rule (image searches have no text).
-- documents has no status column since migration 005, so every document counts as published.

create table public.search_index_status(
 document_id uuid primary key references public.documents(id) on delete cascade,
 processed boolean not null default false,
 last_error text,
 updated_at timestamptz not null default now()
);
create index search_index_status_pending on public.search_index_status(updated_at) where not processed;
alter table public.search_index_status enable row level security;
revoke all on public.search_index_status from anon, authenticated;
grant select, insert, update, delete on public.search_index_status to service_role;

-- A new document, or a change that affects what gets embedded, puts the document back in the queue.
-- The indexing worker must only set processed=true if updated_at is unchanged since it read the row.
create function private.queue_search_index() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.search_index_status(document_id,processed,last_error,updated_at) values(new.id,false,null,now())
 on conflict (document_id) do update set processed=false,last_error=null,updated_at=now();
 return null;
end $$;
revoke all on function private.queue_search_index() from public, anon, authenticated;

create trigger documents_queue_search_index_insert after insert on public.documents
 for each row execute function private.queue_search_index();
create trigger documents_queue_search_index_update after update on public.documents
 for each row when (old.title is distinct from new.title or old.summary is distinct from new.summary
  or old.content_text is distinct from new.content_text or old.cover_url is distinct from new.cover_url)
 execute function private.queue_search_index();

insert into public.search_index_status(document_id) select id from public.documents on conflict do nothing;

-- Search logs: which engine produced the search/click, and whether the query was text or an image.
-- Existing rows came from the keyword search, so the defaults label them correctly.
alter table public.search_logs
 add column engine text not null default 'keyword' check (engine in ('keyword','vector')),
 add column query_type text not null default 'text' check (query_type in ('text','image'));
alter table public.search_logs drop constraint search_logs_query_string_check;
alter table public.search_logs
 add constraint search_logs_query_required check (query_type='image' or length(trim(query_string))>0),
 add constraint search_logs_image_is_vector check (query_type='text' or engine='vector');
