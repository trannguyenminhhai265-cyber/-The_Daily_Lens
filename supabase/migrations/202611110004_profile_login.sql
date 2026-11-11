-- Auth is the source of truth for email and the most recent sign-in.
create or replace function private.profile_json(uid uuid, full_record boolean default false) returns jsonb language sql stable set search_path='' as $$
 select (to_jsonb(p) - 'permissions' - 'status') || case when full_record then jsonb_build_object('permissions',p.permissions,'status',p.status,'email',(select email from auth.users where id=p.id),'last_login_at',(select last_sign_in_at from auth.users where id=p.id),'effective_permissions',private.permissions(p)) else '{}'::jsonb end from public.profiles p where id=uid;
$$;
revoke all on function private.profile_json(uuid,boolean) from public,anon,authenticated;
