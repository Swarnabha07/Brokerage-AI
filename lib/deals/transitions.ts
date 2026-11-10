import type { Role } from '@/lib/auth/server';

export type DealStatus =
  | 'negotiating' | 'agreed' | 'invoiced' | 'paid' | 'shipped' | 'return_window' | 'released' | 'disputed'
  | 'cancelled' | 'refunded';

/**
 * Client-requestable transitions via PATCH /api/deals/[id]. Anything not listed is rejected.
 * Dedicated, verified server paths (never a plain status PATCH):
 *   agreed   -> invoiced      : POST /invoice (seller, final price frozen in an immutable invoice)
 *   invoiced -> paid          : POST /payments/capture after PayPal-verified capture (fn_record_capture)
 *   paid     -> shipped       : PATCH status=shipped (seller) -> fn_mark_shipped
 *   shipped  -> return_window : POST /confirm-receipt (buyer) or admin delivery verification
 *   return_window -> released : fn_evaluate_release (scheduled job or "Check release"), server clock only
 *   *        -> disputed/cancelled/refunded : /dispute, /cancel, admin actions
 */
export const CLIENT_TRANSITIONS: Record<string, { to: DealStatus; roles: Role[] }[]> = {
  negotiating: [{ to: 'agreed', roles: ['buyer', 'seller'] }],
  paid: [{ to: 'shipped', roles: ['seller'] }],
};

export function findClientTransition(from: string | null, to: string, role: Role) {
  const rule = (CLIENT_TRANSITIONS[from ?? ''] || []).find((t) => t.to === to);
  if (!rule) return { ok: false as const, code: 409, error: `Transition ${from} -> ${to} is not allowed` };
  if (!rule.roles.includes(role)) return { ok: false as const, code: 403, error: `Only the ${rule.roles.join('/')} can do this` };
  return { ok: true as const };
}
