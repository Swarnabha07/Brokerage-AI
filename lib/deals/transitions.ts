import type { Role } from '@/lib/auth/server';

export type DealStatus =
  | 'negotiating' | 'agreed' | 'invoiced' | 'paid' | 'shipped' | 'return_window' | 'released' | 'disputed';

/**
 * Client-requestable transitions via PATCH /api/deals/[id]. Anything not listed is rejected.
 * NOT client-requestable (server-only paths):
 *   invoiced -> paid        : PayPal capture verification (Stage 3). Dev-only simulation flag below.
 *   shipped  -> return_window: POST /confirm-receipt (server stamps the start time)
 *   return_window -> released: releaseIfDue() after server-side elapsed-time check
 */
export const CLIENT_TRANSITIONS: Record<string, { to: DealStatus; roles: Role[] }[]> = {
  negotiating: [{ to: 'agreed', roles: ['buyer', 'seller'] }],
  agreed: [{ to: 'invoiced', roles: ['seller'] }],
  paid: [{ to: 'shipped', roles: ['seller'] }],
};

export function findClientTransition(from: string | null, to: string, role: Role) {
  const rule = (CLIENT_TRANSITIONS[from ?? ''] || []).find((t) => t.to === to);
  if (!rule) return { ok: false as const, code: 409, error: `Transition ${from} -> ${to} is not allowed` };
  if (!rule.roles.includes(role)) return { ok: false as const, code: 403, error: `Only the ${rule.roles.join('/')} can do this` };
  return { ok: true as const };
}

/** Dev-only escape hatch until PayPal Sandbox (Stage 3). Never active in production. */
export const DEMO_PAYMENT_SIMULATION_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.DEMO_SIMULATE_PAYMENT === 'true';
