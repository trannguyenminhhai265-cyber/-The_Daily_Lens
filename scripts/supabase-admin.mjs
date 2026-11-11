import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../frontend/package.json',import.meta.url));
const { createClient } = require('@supabase/supabase-js');
export const projectRef = process.env.SUPABASE_PROJECT_REF || 'ihogmftgzhkckbrgnzlq';
export function adminClient() {
  let key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    // Capture credentials in memory; never print keys or include them in browser builds.
    const keys = JSON.parse(execFileSync('supabase',['projects','api-keys',`--remote=${projectRef}`,'--reveal','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    key = keys.find(k=>k.name==='service_role' || k.type==='secret')?.api_key;
  }
  if (!key) throw Error('Set SUPABASE_SECRET_KEY locally or sign in with Supabase CLI. Do not put it in a VITE_ variable.');
  return createClient(process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function checked({data,error}) { if(error) throw Error(error.message); return data; }
