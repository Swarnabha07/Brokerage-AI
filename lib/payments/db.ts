import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mapDbError } from './errors.mjs';
import { HttpError } from './http';

export type Row = Record<string, unknown>;

/** Untyped view of the service-role client: the new tables/functions are not in the generated Database type. */
export const db = supabaseAdmin as unknown as SupabaseClient;

export function dbToHttp(message: string): HttpError {
  const mapped = mapDbError(message) as { status: number; code: string; message: string } | null;
  if (mapped) return new HttpError(mapped.status, mapped.code, mapped.message);
  console.error('[payments:db]', message);
  return new HttpError(500, 'db_error', 'Internal server error');
}

/** Calls an atomic SQL function (server/service-role only). Errors are mapped to safe HTTP errors. */
export async function rpc<T = Row>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw dbToHttp(error.message);
  return data as T;
}
