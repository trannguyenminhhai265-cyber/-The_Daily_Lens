-- Search engine, part 4: one-call vector search for the server-side search function.
-- Requires pgvector and document_embeddings (migration 0002), so tests/supabase.test.mjs skips this file in PGlite.
-- Exact (brute-force) scan, cosine distance via extensions.<=>, same as match_documents in 0002.
-- Filters use the same keys and semantics as private.list_documents (the free-text "q" key is ignored):
--   category (id or slug), tag (id or slug), from (date, inclusive), to (date, inclusive).
-- Returns a jsonb array of articles built by private.document_json(d,false), most similar first, at most n (1..50).
create function public.search_documents_vector(q extensions.vector(768), filters jsonb default '{}', n integer default 10)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(private.document_json(x.d,false) order by x.dist,(x.d).id),'[]'::jsonb)
 from (
  select d, e.embedding operator(extensions.<=>) q as dist
  from public.document_embeddings e
  join public.documents d on d.id=e.document_id
  where (coalesce(filters->>'category','')='' or exists(select 1 from public.categories c where c.id=d.category_id and (c.id::text=filters->>'category' or c.slug=filters->>'category')))
   and (coalesce(filters->>'tag','')='' or exists(select 1 from public.document_tags dt join public.tags t on t.id=dt.tag_id where dt.document_id=d.id and (t.id::text=filters->>'tag' or t.slug=filters->>'tag')))
   and (coalesce(filters->>'from','')='' or d.created_at>=(filters->>'from')::date)
   and (coalesce(filters->>'to','')='' or d.created_at<(filters->>'to')::date+interval '1 day')
  order by dist, d.id
  limit greatest(1, least(coalesce(n,10), 50))
 ) x;
$$;
revoke all on function public.search_documents_vector(extensions.vector, jsonb, integer) from public, anon, authenticated;
grant execute on function public.search_documents_vector(extensions.vector, jsonb, integer) to service_role;
