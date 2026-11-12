export function bearerToken(req) {
  const h = req.headers?.authorization ?? req.headers?.Authorization;
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m ? m[1] : null;
}

// Returns the auth user for a valid JWT, otherwise null (never throws on a bad token).
export async function getUserFromRequest(supabase, req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    return error || !data?.user ? null : data.user;
  } catch { return null; }
}

// -> { ok:true, user } | { ok:false, status:401|403, error }. Role is read with the service role, never from the JWT claims.
export async function requireAdmin(supabase, req) {
  const user = await getUserFromRequest(supabase, req);
  if (!user) return { ok: false, status: 401, error: 'unauthorized' };
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) throw new Error('profile lookup failed');
  if (data?.role !== 'admin') return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, user };
}
