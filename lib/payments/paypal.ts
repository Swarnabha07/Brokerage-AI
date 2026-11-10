import 'server-only';
import { createPaypalClient } from './paypal-core.mjs';
import { getPaymentsConfig } from './config';

let client: ReturnType<typeof createPaypalClient> | null = null;
let key = '';

/** Sandbox-only client (see paypal-core.mjs). Rebuilt if credentials change. */
export function getPaypal() {
  const cfg = getPaymentsConfig();
  const k = `${cfg.clientId}:${cfg.secret.length}`;
  if (!client || key !== k) {
    client = createPaypalClient({ clientId: cfg.clientId, secret: cfg.secret });
    key = k;
  }
  return client;
}
