-- Search engine, part 2: vector storage and exact (brute-force, no index) nearest-neighbour search.
-- Requires pgvector. On Supabase the extension lives in schema "extensions".
-- PGlite (used by tests/supabase.test.mjs) ships without pgvector, so the local test skips this file.
-- Vectors are 768-dimensional gemini-embedding-2 output; changing model or size means re-embedding.
create extension if not exists vector with schema extensions;

create table public.document_embeddings(
 document_id uuid primary key references public.documents(id) on delete cascade,
 embedding extensions.vector(768) not null,
 model text not null,
 updated_at timestamptz not null default now()
);
create table public.image_embeddings(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id) on delete cascade,
 image_url text not null,
 embedding extensions.vector(768) not null,
 model text not null,
 updated_at timestamptz not null default now(),
 unique(document_id,image_url)
);

-- Same convention as the other tables: no browser role touches them; only the server (service_role) does.
do $$ declare t text; begin
 foreach t in array array['document_embeddings','image_embeddings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select, insert, update, delete on public.%I to service_role',t);
 end loop; end $$;

-- score = cosine similarity (1 - cosine distance). Callers must embed the query with the same model and size.
-- These live in "public" because supabase-js (PostgREST) only reaches exposed schemas; execute is limited to
-- service_role below, so browser roles cannot call them. Only the server-side search function does.
create function public.match_documents(q extensions.vector(768), n integer default 10)
returns table(document_id uuid, score double precision) language sql stable set search_path='' as $$
 select e.document_id, 1 - (e.embedding operator(extensions.<=>) q)
 from public.document_embeddings e
 order by e.embedding operator(extensions.<=>) q
 limit greatest(1, least(n, 50));
$$;
create function public.match_images(q extensions.vector(768), n integer default 10)
returns table(document_id uuid, image_url text, score double precision) language sql stable set search_path='' as $$
 select e.document_id, e.image_url, 1 - (e.embedding operator(extensions.<=>) q)
 from public.image_embeddings e
 order by e.embedding operator(extensions.<=>) q
 limit greatest(1, least(n, 50));
$$;
revoke all on function public.match_documents(extensions.vector, integer) from public, anon, authenticated;
revoke all on function public.match_images(extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.match_documents(extensions.vector, integer) to service_role;
grant execute on function public.match_images(extensions.vector, integer) to service_role;
