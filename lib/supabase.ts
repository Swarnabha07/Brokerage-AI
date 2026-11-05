import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Browser Supabase client. Uses cookie storage (via @supabase/ssr) so the same
 * verified session is visible to server code and Realtime. Browser/client use ONLY.
 * Server code must use lib/supabase/server.ts; privileged code lib/supabase/admin.ts.
 */
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
