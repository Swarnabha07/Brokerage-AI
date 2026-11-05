import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

let client: SupabaseClient<Database> | null = null;

function getAdmin(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!serviceKey) {
    // Fail closed at REQUEST time in production (not at build time).
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in production.');
    }
    console.warn(
      '[supabase-admin] SUPABASE_SERVICE_ROLE_KEY missing: using the anon key (local dev only). ' +
        'Writes may fail under RLS. Add the service-role key to .env.local.'
    );
  }
  client = createClient<Database>(url, serviceKey || anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/**
 * PRIVILEGED client (bypasses RLS when the service-role key is set). Created lazily.
 * Only use AFTER the caller has been verified with requireUser() and authorized for the
 * specific resource. Never import into client components.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get: (_t, prop) => Reflect.get(getAdmin(), prop),
});
