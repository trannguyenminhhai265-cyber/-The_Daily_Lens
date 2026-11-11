// Preserve the screen-facing API shape while using Supabase Auth + PostgreSQL RPC.
import { getSupabase } from './supabase';
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
function check({ data, error }) {
  if (error) throw new ApiError(error.status || ({ '42501': 403, P0002: 404, '23505': 409 }[error.code]) || 400, error.message, error.details);
  return data;
}
function sessionId() {
  try {
    let id = sessionStorage.getItem('dl_session');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('dl_session', id); }
    return id;
  } catch { return ''; }
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) throw new ApiError(400, 'Password must contain at least 8 characters, one letter and one number');
}
export async function api(path, { method = 'GET', body = {}, params = {} } = {}) {
  const client = getSupabase();
  const url = new URL(path, 'https://local.invalid');
  path = url.pathname;
  params = { ...Object.fromEntries(url.searchParams), ...params };
  const rpc = async (route, verb = 'GET', payload = {}, query = {}) => check(await client.rpc('portal_api', { path: route, method: verb, body: payload, params: query, session_id: sessionId() }));
  if (path === '/auth/register') {
    validatePassword(body.password);
    const { user, session } = check(await client.auth.signUp({ email: body.email.trim(), password: body.password, options: { data: { username: body.username.toLowerCase().trim(), display_name: body.display_name || body.username }, emailRedirectTo: `${window.location.origin}/profile` } }));
    return { user: session ? (await rpc('/auth/me')).user : null, confirmationRequired: Boolean(user && !session) };
  }
  if (path === '/auth/login') {
    // Email login avoids exposing an endpoint that resolves usernames to private emails.
    check(await client.auth.signInWithPassword({ email: body.login.trim(), password: body.password }));
    try { return await rpc('/auth/me'); } catch (error) { await client.auth.signOut(); throw error; }
  }
  if (path === '/auth/recover') {
    check(await client.auth.resetPasswordForEmail(body.email.trim(), { redirectTo: `${window.location.origin}/reset-password` }));
    return { ok: true };
  }
  if (path === '/auth/reset-password') {
    validatePassword(body.password);
    check(await client.auth.updateUser({ password: body.password }));
    return { ok: true };
  }
  if (path === '/auth/me/password') {
    validatePassword(body.new_password);
    const { user } = check(await client.auth.getUser());
    check(await client.auth.signInWithPassword({ email: user.email, password: body.current_password }));
    check(await client.auth.updateUser({ password: body.new_password }));
    return { ok: true };
  }
  if (path === '/auth/me' && method === 'PUT') {
    // Auth handles email confirmation; the profiles table never stores credentials.
    if (body.email) check(await client.auth.updateUser({ email: body.email }));
    return rpc(path, method, body);
  }
  return rpc(path, method, body, params);
}
