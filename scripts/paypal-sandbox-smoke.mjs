#!/usr/bin/env node
/**
 * Brokerage AI - PayPal SANDBOX smoke test (Gate 1)
 *
 * Standalone, dependency-free, interactive and resumable. Proves that our Sandbox
 * app + accounts support: OAuth -> Invoice -> Order -> Capture -> record payment
 * on the invoice -> Payout. It imports nothing from the application.
 *
 * SANDBOX ONLY: the one and only API host is the constant BASE_URL below, and the
 * script refuses to run unless PAYPAL_ENVIRONMENT is exactly "SANDBOX".
 *
 * Usage: see scripts/PAYPAL_SMOKE_TEST.md  (node --env-file=.env.local scripts/paypal-sandbox-smoke.mjs)
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

// ---------------------------------------------------------------- constants
const BASE_URL = 'https://api-m.sandbox.paypal.com'; // the ONLY host this script talks to
const STATE_PATH = fileURLToPath(new URL('../.paypal-smoke-state.json', import.meta.url));
const CURRENCY = 'USD';
const PRICE_CENTS = 500; // seller amount: $5.00
const FEE_CENTS = Math.round((PRICE_CENTS * 3) / 100); // 3% platform fee, integer math
const TOTAL_CENTS = PRICE_CENTS + FEE_CENTS; // buyer pays price + fee
const TIMEOUT_MS = 30_000;
const POLL_MS = Number(process.env.PAYPAL_SMOKE_POLL_MS) || 5000;
const POLL_TRIES = 12;
const EXIT = { OK: 0, FAIL: 1, PAUSED: 2, CONFIG: 3 };
const ENV_REQUIRED = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_SECRET',
  'PAYPAL_ENVIRONMENT',
  'PAYPAL_PLATFORM_BUSINESS_EMAIL',
  'PAYPAL_SMOKE_BUYER_EMAIL',
  'PAYPAL_SMOKE_SELLER_EMAIL',
];

const money = (cents) => (cents / 100).toFixed(2);
const PRICE = money(PRICE_CENTS);
const FEE = money(FEE_CENTS);
const TOTAL = money(TOTAL_CENTS);

// -------------------------------------------------------------------- flags
const KNOWN_FLAGS = new Set([
  '--help', '--status', '--fresh', '--confirm-new-payout', '--retry-record', '--probe-duplicates', '--yes',
]);
const argv = process.argv.slice(2);
const FLAGS = {
  help: argv.includes('--help'),
  status: argv.includes('--status'),
  fresh: argv.includes('--fresh'),
  confirmNewPayout: argv.includes('--confirm-new-payout'),
  retryRecord: argv.includes('--retry-record'),
  probeDuplicates: argv.includes('--probe-duplicates'),
  yes: argv.includes('--yes'),
};

// ------------------------------------------------------ safe output / scrub
// Nothing secret is ever logged. Every error string passes through scrub().
let SCRUB_VALUES = []; // exact secret-ish values to blank out if they ever appear
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_RE = /https?:\/\/[^\s"')\]]+/g;

function scrub(text) {
  let s = String(text ?? '');
  for (const v of SCRUB_VALUES) if (v) s = s.split(v).join('[redacted]');
  return s.replace(URL_RE, '[url]').replace(EMAIL_RE, '[email]');
}
const out = (m = '') => console.log(m);
const info = (m) => out(`    ${m}`);
const pass = (m) => out(`  [PASS] ${m}`);
const warn = (m) => out(`  [WARN] ${m}`);
const bad = (m) => out(`  [FAIL] ${m}`);
const head = (m) => out(`\n=== ${m}`);

function exitNow(code, msg) {
  if (msg) out(`\n${msg}`);
  process.exit(code);
}
const configError = (msg) => exitNow(EXIT.CONFIG, `CONFIG ERROR: ${msg}`);

// ------------------------------------------------------------------- config
function loadConfig() {
  // Fail closed FIRST, before anything else happens.
  if ((process.env.PAYPAL_ENVIRONMENT ?? '').trim() !== 'SANDBOX') {
    configError('PAYPAL_ENVIRONMENT must be exactly "SANDBOX". Refusing to run.');
  }
  const missing = ENV_REQUIRED.filter((k) => !(process.env[k] ?? '').trim());
  if (missing.length) configError(`Missing environment variables (names only): ${missing.join(', ')}`);

  const clientId = process.env.PAYPAL_CLIENT_ID.trim();
  const secret = process.env.PAYPAL_SECRET.trim();
  if (/^your-/i.test(clientId) || /^your-/i.test(secret)) {
    configError('PAYPAL_CLIENT_ID / PAYPAL_SECRET still look like .env.example placeholders.');
  }
  const emails = {
    platform: process.env.PAYPAL_PLATFORM_BUSINESS_EMAIL.trim().toLowerCase(),
    buyer: process.env.PAYPAL_SMOKE_BUYER_EMAIL.trim().toLowerCase(),
    seller: process.env.PAYPAL_SMOKE_SELLER_EMAIL.trim().toLowerCase(),
  };
  for (const [role, e] of Object.entries(emails)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) configError(`The ${role} email variable is not a valid email address.`);
  }
  const distinct = new Set(Object.values(emails));
  if (distinct.size !== 3) {
    configError(
      'Platform, buyer and seller emails must be three DIFFERENT Sandbox accounts ' +
        '(paying or paying out to the merchant itself is not a valid marketplace test).'
    );
  }
  SCRUB_VALUES = [secret, clientId, ...Object.values(emails)];
  const fingerprint = createHash('sha256').update(Object.values(emails).join('|')).digest('hex').slice(0, 16);
  return { clientId, secret, emails, fingerprint };
}

// -------------------------------------------------------------- state file
// Only identifiers and step progress are stored. Never tokens, secrets or emails.
function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    configError(`State file is unreadable. Inspect or delete it deliberately: ${STATE_PATH}`);
  }
}
function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}
function newState(fingerprint) {
  return {
    version: 1,
    environment: 'SANDBOX',
    runId: randomBytes(6).toString('hex'),
    createdAt: new Date().toISOString(),
    fingerprint,
    amounts: { priceCents: PRICE_CENTS, feeCents: FEE_CENTS, totalCents: TOTAL_CENTS, currency: CURRENCY },
    invoice: {},
    order: {},
    record: {},
    payout: {},
    identity: {},
    results: {},
    completedAt: null,
  };
}

// --------------------------------------------------------------------- HTTP
let cachedToken = null; // memory only, never persisted or printed
let CFG = null;

function kindOf(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 429 || status >= 500) return 'inconclusive';
  return 'rejected';
}

async function fetchToken() {
  const basic = Buffer.from(`${CFG.clientId}:${CFG.secret}`).toString('base64');
  const r = await rawRequest('POST', '/v1/oauth2/token', {
    headers: { Authorization: `Basic ${basic}` },
    form: 'grant_type=client_credentials',
  });
  if (!r.ok || !r.json?.access_token) return { ok: false, r };
  cachedToken = r.json.access_token;
  SCRUB_VALUES.push(cachedToken);
  return { ok: true };
}

async function rawRequest(method, path, { headers = {}, body, form } = {}) {
  if (!path.startsWith('/')) throw new Error('internal: path must start with "/"');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const h = { Accept: 'application/json', ...headers };
    let payload;
    if (form !== undefined) {
      h['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = form;
    } else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE_URL + path, { method, headers: h, body: payload, signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, json, kind: kindOf(res.status) };
  } catch (e) {
    return { status: 0, ok: false, json: null, kind: 'inconclusive', network: e?.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function pp(method, path, opts = {}) {
  if (!cachedToken) {
    const t = await fetchToken();
    if (!t.ok) return t.r;
  }
  const withAuth = () => ({ ...opts, headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${cachedToken}` } });
  let r = await rawRequest(method, path, withAuth());
  if (r.status === 401) { // token expired mid-run: refresh once
    cachedToken = null;
    const t = await fetchToken();
    if (!t.ok) return t.r;
    r = await rawRequest(method, path, withAuth());
  }
  return r;
}

/** Whitelisted, scrubbed error details. Never the raw body, headers or links. */
function safeErr(r) {
  if (r.network) return { status: 0, network: r.network };
  const j = r.json ?? {};
  return {
    status: r.status,
    name: j.name ?? j.error ?? undefined,
    message: scrub(j.message ?? j.error_description ?? ''),
    issues: (Array.isArray(j.details) ? j.details : []).slice(0, 5).map((d) => ({
      issue: d.issue, field: d.field, description: scrub(d.description ?? ''),
    })),
    debug_id: j.debug_id,
  };
}
function fmtErr(e) {
  if (e.network) return `no usable response (${e.network})`;
  const issues = (e.issues ?? []).map((i) => [i.issue, i.field && `field=${i.field}`, i.description].filter(Boolean).join(' ')).join(' | ');
  return [`HTTP ${e.status}`, e.name, e.message, issues && `[${issues}]`, e.debug_id && `debug_id=${e.debug_id}`].filter(Boolean).join(' - ');
}
const hasIssue = (e, ...names) => (e.issues ?? []).some((i) => names.includes(i.issue)) || names.includes(e.name);

// ---------------------------------------------------------------- prompting
async function ask(q) {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim(); } finally { rl.close(); }
}
async function confirm(q) {
  if (FLAGS.yes) return true;
  const a = await ask(`${q} [y/N] `);
  return a !== null && a.toLowerCase() === 'y';
}

// ------------------------------------------------------------ step helpers
const R = (status, detail = '') => ({ status, detail });
const idFromHref = (s, re) => (typeof s === 'string' ? s.match(re)?.[1] : undefined);

// ------------------------------------------------------- identity (fail closed)
// A CONFIRMED conflict stops the workflow. A field PayPal did not return is reported as
// UNAVAILABLE: not a mismatch, but explicitly NOT independently verified. Only the words
// MATCH / MISMATCH / UNAVAILABLE are printed or stored, never the email addresses.
const normEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const IDENTITY_LABEL = {
  invoicer: 'Invoicer (platform merchant)',
  payee: 'Payee (platform merchant)',
  payer: 'Payer (buyer)',
};

/** Compare every value PayPal returned for one identity with the expected account. */
function compareIdentity(returned, expected) {
  const seen = returned.map(normEmail).filter(Boolean);
  if (seen.length === 0) return 'UNAVAILABLE';
  const want = normEmail(expected);
  return seen.every((v) => v === want) ? 'MATCH' : 'MISMATCH'; // any conflicting value => MISMATCH
}
function identityOf(kind, doc) {
  if (kind === 'invoicer') return compareIdentity([doc?.invoicer?.email_address], CFG.emails.platform);
  if (kind === 'payee') return compareIdentity([doc?.purchase_units?.[0]?.payee?.email_address], CFG.emails.platform);
  if (kind === 'payer') {
    return compareIdentity([doc?.payment_source?.paypal?.email_address, doc?.payer?.email_address], CFG.emails.buyer);
  }
  throw new Error(`internal: unknown identity kind ${kind}`);
}
/** Persist the status. A recorded MISMATCH is sticky: later runs cannot overwrite it. */
function recordIdentity(state, kind, status) {
  state.identity ??= {};
  if (state.identity[kind] === 'MISMATCH') return 'MISMATCH';
  state.identity[kind] = status;
  saveState(state);
  return status;
}
function reportIdentity(kind, status) {
  const label = IDENTITY_LABEL[kind];
  if (status === 'MATCH') pass(`${label} matches the configured account`);
  else if (status === 'MISMATCH') bad(`${label} CONFLICTS with the configured account (values not shown). STOPPING.`);
  else out(`  [UNAVAILABLE] ${label}: PayPal did not return this field, so the identity could NOT be independently verified.`);
}
const identityMismatches = (state) => Object.entries(state.identity ?? {}).filter(([, v]) => v === 'MISMATCH').map(([k]) => k);
/** Defense in depth: refuse any step once a mismatch has been recorded (until --fresh). */
function identityBlock(state, what) {
  const m = identityMismatches(state);
  if (!m.length) return null;
  bad(`An identity mismatch was recorded earlier (${m.join(', ')}). ${what} refused. Fix the account configuration, then re-run with --fresh.`);
  return R('FAIL', `identity mismatch: ${m.join(', ')}`);
}
const identityLine = (state) => ['invoicer', 'payee', 'payer'].map((k) => `${k}=${state.identity?.[k] ?? '-'}`).join('  ');

// ---------------------------------------------------------------- A: OAuth
async function stepAuth() {
  head('Step A - OAuth (Sandbox)');
  const t = await fetchToken();
  if (!t.ok) {
    bad(`OAuth failed: ${fmtErr(safeErr(t.r))}`);
    info('Check that PAYPAL_CLIENT_ID / PAYPAL_SECRET belong to a SANDBOX app (not Live).');
    return R('FAIL', 'oauth');
  }
  pass('Access token obtained (held in memory only, never printed or stored)');
  return R('PASS');
}

// -------------------------------------------------------------- B: Invoice
function invoiceBody(state) {
  const price = { currency_code: CURRENCY, value: PRICE };
  const fee = { currency_code: CURRENCY, value: FEE };
  return {
    detail: {
      invoice_number: state.invoice.number,
      reference: `smoke-${state.runId}`,
      currency_code: CURRENCY,
      note: 'SANDBOX TEST INVOICE - Brokerage AI Gate 1. Not a real charge.',
      payment_term: { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: { email_address: CFG.emails.platform },
    primary_recipients: [
      { billing_info: { email_address: CFG.emails.buyer, name: { given_name: 'Sandbox', surname: 'Buyer' } } },
    ],
    items: [
      { name: 'SANDBOX TEST - product', quantity: '1', unit_amount: price },
      { name: 'SANDBOX TEST - platform fee (3%)', quantity: '1', unit_amount: fee },
    ],
    configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
  };
}

async function getInvoice(id) {
  return pp('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

async function findInvoiceByNumber(number) {
  const r = await pp('POST', '/v2/invoicing/search-invoices?page=1&page_size=5&total_required=false', {
    body: { invoice_number: number },
  });
  if (!r.ok) return { searched: false };
  const id = r.json?.items?.[0]?.id;
  return { searched: true, id };
}

async function stepInvoice(state) {
  head('Step B - Invoice (create, send WITHOUT notifications, verify)');
  const blockedB = identityBlock(state, 'Invoice step');
  if (blockedB) return blockedB;
  const inv = state.invoice;
  inv.number ??= `BRK-SMK-${state.runId}`;

  if (!inv.id) {
    if (inv.createAttempted) {
      info('A previous create attempt was inconclusive; looking it up by invoice number instead of re-creating...');
      const found = await findInvoiceByNumber(inv.number);
      if (found.id) { inv.id = found.id; inv.createAttempted = false; saveState(state); pass(`Adopted existing invoice ${inv.id}`); }
      else {
        bad('Could not confirm whether the earlier create succeeded, and no matching invoice was found.');
        info('Refusing to create a possible duplicate. Check the Business sandbox account\'s invoices, or re-run with --fresh.');
        return R('PAUSED', 'invoice create unresolved');
      }
    } else {
      inv.createAttempted = true; saveState(state); // persist intent BEFORE the call
      const r = await pp('POST', '/v2/invoicing/invoices', { body: invoiceBody(state), headers: { Prefer: 'return=representation' } });
      if (r.ok) {
        inv.id = r.json?.id ?? idFromHref(r.json?.href ?? r.json?.links?.[0]?.href, /invoices\/([A-Za-z0-9-]+)/);
        inv.createAttempted = false; saveState(state);
        if (!inv.id) { bad('Invoice created but no ID could be read from the response.'); return R('FAIL', 'no invoice id'); }
        pass(`Invoice created: ${inv.id} (DRAFT)`);
      } else if (r.kind === 'rejected') {
        inv.createAttempted = false; saveState(state);
        const e = safeErr(r);
        bad(`PayPal rejected invoice creation: ${fmtErr(e)}`);
        if (hasIssue(e, 'DUPLICATE_INVOICE_NUMBER')) info('That invoice number already exists. Use --fresh for a new run ID.');
        return R('FAIL', 'invoice create rejected');
      } else {
        warn(`Invoice create was INCONCLUSIVE (${fmtErr(safeErr(r))}). Re-run to resolve it safely; nothing will be duplicated.`);
        return R('INCONCLUSIVE', 'invoice create');
      }
    }
  } else {
    info(`Resuming with invoice ${inv.id}`);
  }

  // Optional probe: does PayPal reject a duplicate invoice_number?
  if (FLAGS.probeDuplicates && !inv.dupProbeDone) {
    const r = await pp('POST', '/v2/invoicing/invoices', { body: invoiceBody(state) });
    inv.dupProbeDone = true; saveState(state);
    if (r.kind === 'rejected') pass(`Duplicate-number probe: PayPal REJECTED a second invoice with the same number (${(safeErr(r).issues[0]?.issue) ?? `HTTP ${r.status}`})`);
    else if (r.ok) warn('Duplicate-number probe: PayPal ACCEPTED a duplicate invoice_number. Do NOT rely on invoice_number for dedupe.');
    else warn('Duplicate-number probe was inconclusive.');
  }

  // Send with NO notifications. The send response is deliberately discarded:
  // it can contain the hosted payer link, which must never be shown or stored.
  let g = await getInvoice(inv.id);
  if (!g.ok) { bad(`Cannot read invoice: ${fmtErr(safeErr(g))}`); return R(g.kind === 'inconclusive' ? 'INCONCLUSIVE' : 'FAIL', 'invoice read'); }
  if (recordIdentity(state, 'invoicer', identityOf('invoicer', g.json)) === 'MISMATCH') {
    reportIdentity('invoicer', 'MISMATCH');
    info(`Invoice ${inv.id} was created but is NOT being sent. Nothing further will run.`);
    return R('FAIL', 'invoicer identity mismatch');
  }
  if (g.json?.status === 'DRAFT') {
    const s = await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(inv.id)}/send`, {
      body: { send_to_recipient: false, send_to_invoicer: false },
    });
    if (s.ok) pass('Send accepted with send_to_recipient=false and send_to_invoicer=false (response body discarded)');
    else if (s.kind === 'rejected') { bad(`PayPal rejected send: ${fmtErr(safeErr(s))}`); return R('FAIL', 'invoice send rejected'); }
    else warn(`Send was inconclusive (${fmtErr(safeErr(s))}); verifying actual status below.`);
    g = await getInvoice(inv.id);
    if (!g.ok) return R('INCONCLUSIVE', 'invoice re-read');
  } else {
    info(`Invoice is already past DRAFT (${g.json?.status}); not sending again.`);
  }

  const j = g.json ?? {};
  inv.status = j.status;
  inv.sent = ['SENT', 'UNPAID', 'PAID', 'PARTIALLY_PAID'].includes(j.status);
  saveState(state);

  const checks = [
    [['SENT', 'UNPAID', 'PAID'].includes(j.status), `status is payable/sent state (got ${j.status})`],
    [j.amount?.value === TOTAL && j.amount?.currency_code === CURRENCY, `total is ${TOTAL} ${CURRENCY} (got ${j.amount?.value} ${j.amount?.currency_code})`],
    [(j.items?.length ?? 0) === 2, `has 2 line items (product + fee) (got ${j.items?.length})`],
    [j.detail?.invoice_number === inv.number, 'invoice number matches'],
  ];
  let ok = true;
  for (const [c, label] of checks) { (c ? pass : bad)(label); ok &&= c; }
  const payerLink = Boolean(j.detail?.metadata?.recipient_view_url);
  info(`Hosted payer link exists: ${payerLink ? 'yes (deliberately NOT displayed or stored)' : 'no'}`);
  const invoicerId = recordIdentity(state, 'invoicer', identityOf('invoicer', j));
  reportIdentity('invoicer', invoicerId);
  if (invoicerId === 'MISMATCH') return R('FAIL', 'invoicer identity mismatch');
  if (!ok) return R('FAIL', 'invoice verification');
  return R('PASS', `${inv.id} ${j.status}`);
}

// ---------------------------------------------------------------- C: Order
const approvalLink = (order) => (order?.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
const getOrder = (id) => pp('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`);

function orderBody(state) {
  const price = { currency_code: CURRENCY, value: PRICE };
  const fee = { currency_code: CURRENCY, value: FEE };
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: `smoke-${state.runId}`,
      custom_id: state.order.customId,
      description: 'Brokerage AI SANDBOX smoke test',
      amount: { currency_code: CURRENCY, value: TOTAL, breakdown: { item_total: { currency_code: CURRENCY, value: TOTAL } } },
      items: [
        { name: 'SANDBOX TEST - product', quantity: '1', unit_amount: price, category: 'DIGITAL_GOODS' },
        { name: 'SANDBOX TEST - platform fee (3%)', quantity: '1', unit_amount: fee, category: 'DIGITAL_GOODS' },
      ],
    }],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_SETTLEMENT',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: 'https://example.com/paypal-smoke/return',
          cancel_url: 'https://example.com/paypal-smoke/cancel',
        },
      },
    },
  };
}

async function stepOrder(state) {
  head('Step C - Orders API (create, wait for buyer approval)');
  const o = state.order;
  o.customId ??= `smoke-${state.runId}`;
  o.requestId ??= `brk-smoke-order-${state.runId}`;
  o.captureRequestId ??= `brk-smoke-cap-${state.runId}`;

  if (!o.id) {
    // Same PayPal-Request-Id => PayPal returns the original order, so a retry cannot duplicate it.
    const r = await pp('POST', '/v2/checkout/orders', {
      body: orderBody(state),
      headers: { 'PayPal-Request-Id': o.requestId, Prefer: 'return=representation' },
    });
    if (!r.ok) {
      const e = safeErr(r);
      (r.kind === 'rejected' ? bad : warn)(`Order create ${r.kind === 'rejected' ? 'rejected' : 'inconclusive'}: ${fmtErr(e)}`);
      return R(r.kind === 'rejected' ? 'FAIL' : 'INCONCLUSIVE', 'order create');
    }
    o.id = r.json?.id;
    if (!o.id) { bad('Order created but no ID in response.'); return R('FAIL', 'no order id'); }
    saveState(state);
    pass(`Order created: ${o.id} (intent CAPTURE, ${TOTAL} ${CURRENCY}, custom_id ${o.customId})`);
  } else {
    info(`Resuming with order ${o.id}`);
  }

  for (;;) {
    const g = await getOrder(o.id);
    if (!g.ok) { warn(`Cannot read order: ${fmtErr(safeErr(g))}`); return R('INCONCLUSIVE', 'order read'); }
    const status = g.json?.status;
    o.status = status; saveState(state);
    if (status === 'APPROVED' || status === 'COMPLETED') { pass(`Order status: ${status}`); return R('PASS', `${o.id} ${status}`); }
    if (status === 'VOIDED') { bad('Order is VOIDED (expired or cancelled). Re-run with --fresh.'); return R('FAIL', 'order voided'); }

    out('');
    out(`  ACTION REQUIRED - approve this SANDBOX order as the BUYER (Personal) account:`);
    out(`    1. Open this URL in a private/incognito browser window:`);
    out(`       ${approvalLink(g.json) ?? '(no approval link returned - re-run to refetch)'}`);
    out(`    2. Log in with your Sandbox PERSONAL (buyer) account and approve the payment.`);
    out(`    3. You will be redirected to example.com - that is expected. Come back here.`);
    const a = await ask('  Press Enter once approved (or type q to pause): ');
    if (a === null) return R('PAUSED', 'awaiting buyer approval (non-interactive: re-run after approving)');
    if (a.toLowerCase() === 'q') return R('PAUSED', 'paused by user');
  }
}

// -------------------------------------------------------- D: Capture/verify
function verifyOrder(state, order) {
  const o = state.order;
  const pu = order?.purchase_units?.[0];
  const caps = pu?.payments?.captures ?? [];
  const cap = caps[0];
  const checks = [
    [order?.id === o.id, 'order id matches'],
    [order?.status === 'COMPLETED', `order status COMPLETED (got ${order?.status})`],
    [order?.intent === 'CAPTURE', `intent CAPTURE (got ${order?.intent})`],
    [pu?.custom_id === o.customId, 'custom_id matches our internal reference'],
    [pu?.amount?.value === TOTAL && pu?.amount?.currency_code === CURRENCY, `order amount ${TOTAL} ${CURRENCY} (got ${pu?.amount?.value} ${pu?.amount?.currency_code})`],
    [caps.length === 1, `exactly one capture (got ${caps.length})`],
    [cap?.status === 'COMPLETED', `capture status COMPLETED (got ${cap?.status})`],
    [cap?.amount?.value === TOTAL && cap?.amount?.currency_code === CURRENCY, `captured amount ${TOTAL} ${CURRENCY} (got ${cap?.amount?.value} ${cap?.amount?.currency_code})`],
    [typeof cap?.id === 'string' && cap.id.length > 0 && cap.id.length <= 22, 'capture id present and within 22 chars'],
  ];
  return { checks, cap, allOk: checks.every(([c]) => c) };
}

async function stepCapture(state) {
  head('Step D - Capture and verify');
  const blockedD = identityBlock(state, 'Capture step');
  if (blockedD) return blockedD;
  const o = state.order;

  if (!o.verified) {
    let g = await getOrder(o.id);
    if (!g.ok) return R('INCONCLUSIVE', 'order read');
    if (g.json?.status === 'APPROVED') {
      // Fail closed BEFORE any money moves, using whatever identity PayPal already exposes.
      const pre = ['payee', 'payer'].map((k) => [k, recordIdentity(state, k, identityOf(k, g.json))]);
      const preBad = pre.filter(([, st]) => st === 'MISMATCH');
      if (preBad.length) {
        for (const [k, st] of preBad) reportIdentity(k, st);
        info('Order was NOT captured: no money moved. Nothing further will run.');
        return R('FAIL', `identity mismatch before capture: ${preBad.map(([k]) => k).join(', ')}`);
      }
      const preUnavail = pre.filter(([, st]) => st === 'UNAVAILABLE').map(([k]) => k);
      if (preUnavail.length) info(`Before capture, PayPal did not return: ${preUnavail.join(', ')}. Will re-check after capture.`);
      o.captureAttempted = true; saveState(state);
      const r = await pp('POST', `/v2/checkout/orders/${encodeURIComponent(o.id)}/capture`, {
        body: {}, headers: { 'PayPal-Request-Id': o.captureRequestId, Prefer: 'return=representation' },
      });
      if (r.ok) info('Capture call accepted; re-fetching the order from PayPal to verify...');
      else {
        const e = safeErr(r);
        if (hasIssue(e, 'ORDER_ALREADY_CAPTURED')) info('ORDER_ALREADY_CAPTURED: not an error, verifying via re-fetch...');
        else if (r.kind === 'rejected') { bad(`Capture rejected: ${fmtErr(e)}`); if (hasIssue(e, 'INSTRUMENT_DECLINED')) info('Funding source declined; the buyer would need to retry or pick another.'); return R('FAIL', 'capture rejected'); }
        else warn(`Capture response inconclusive (${fmtErr(e)}). NOT assuming failure: verifying actual state...`);
      }
      g = await getOrder(o.id);
      if (!g.ok) return R('INCONCLUSIVE', 'order re-read after capture');
    } else if (g.json?.status !== 'COMPLETED') {
      warn(`Order is ${g.json?.status}, not APPROVED/COMPLETED. Nothing captured.`);
      return R('PAUSED', `order ${g.json?.status}`);
    }

    const cap0 = g.json?.purchase_units?.[0]?.payments?.captures?.[0];
    if (cap0?.status === 'PENDING') { warn(`Capture ${cap0.id} is PENDING (not usable as money yet). Re-run later to poll.`); return R('PENDING', `capture ${cap0.id} pending`); }

    const v = verifyOrder(state, g.json);
    for (const [c, label] of v.checks) (c ? pass : bad)(label);

    // Identity checks are NOT optional: a confirmed conflict stops everything.
    const post = ['payee', 'payer'].map((k) => [k, recordIdentity(state, k, identityOf(k, g.json))]);
    for (const [k, st] of post) reportIdentity(k, st);
    const postBad = post.filter(([, st]) => st === 'MISMATCH');
    if (postBad.length) {
      bad(`Order ${o.id} / capture ${v.cap?.id ?? '?'} exist at PayPal, but this run will NOT accept them.`);
      info('No invoice payment will be recorded and no payout will be made. Fix the account configuration, then use --fresh.');
      return R('FAIL', `identity mismatch after capture: ${postBad.map(([k]) => k).join(', ')}`);
    }

    if (!v.allOk) return R('FAIL', 'verification checks failed');
    o.captureId = v.cap.id; o.verified = true; o.captureStatus = v.cap.status; saveState(state);
  } else {
    info('Capture already verified in a previous run; skipping.');
  }
  pass(`Verified: order ${o.id}, capture ${o.captureId} (${o.captureStatus}), ${TOTAL} ${CURRENCY}`);
  return R('PASS', `capture ${o.captureId}`);
}

// ------------------------------------------- E: record payment on invoice
async function stepRecord(state) {
  head('Step E - Record the verified capture against the invoice');
  const blockedE = identityBlock(state, 'Invoice payment recording');
  if (blockedE) return blockedE;
  const { invoice: inv, order: o, record: rec } = state;
  if (!o.verified || !inv.id) return R('SKIPPED', 'needs verified capture and an invoice');

  if (rec.result === 'ok') { info('Already recorded in a previous run.'); return R('PASS', `invoice ${rec.invoiceStatus}`); }
  if (rec.result === 'rejected' && !FLAGS.retryRecord) {
    bad('PayPal rejected this in a previous run (use --retry-record to try again):');
    info(fmtErr(rec.error));
    return R('REJECTED', 'see error above');
  }

  let g = await getInvoice(inv.id);
  if (g.ok) {
    const idE = recordIdentity(state, 'invoicer', identityOf('invoicer', g.json));
    if (idE !== 'MATCH') reportIdentity('invoicer', idE); // UNAVAILABLE is shown; MISMATCH stops below
    if (idE === 'MISMATCH') return R('FAIL', 'invoicer identity mismatch before recording payment');
  } else {
    out(`  [UNAVAILABLE] ${IDENTITY_LABEL.invoicer}: invoice could not be read, so the identity could NOT be re-verified.`);
  }
  if (g.ok && g.json?.status === 'PAID') {
    rec.result = 'ok'; rec.invoiceStatus = 'PAID'; saveState(state);
    pass('Invoice is already PAID at PayPal; adopting (no second record call).');
    return R('PASS', 'invoice PAID');
  }

  rec.attempted = true; saveState(state);
  const r = await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(inv.id)}/payments`, {
    body: { method: 'PAYPAL', payment_id: o.captureId, amount: { currency_code: CURRENCY, value: TOTAL } },
  });

  if (r.kind === 'rejected') {
    const e = safeErr(r);
    rec.result = 'rejected'; rec.error = e; saveState(state);
    bad(`PayPal REJECTED record-payment: ${fmtErr(e)}`);
    info('Request sent: method=PAYPAL, payment_id=<capture id>, amount=<invoice total>.');
    info('RECOMMENDATION: use Orders-only for the app (skip invoices). No workaround attempted, per plan.');
    return R('REJECTED', fmtErr(e));
  }
  if (!r.ok) warn(`record-payment inconclusive (${fmtErr(safeErr(r))}); checking invoice state...`);

  g = await getInvoice(inv.id);
  if (!g.ok) return R('INCONCLUSIVE', 'invoice re-read');
  const status = g.json?.status;
  inv.status = status; saveState(state);
  if (status === 'PAID') {
    rec.result = 'ok'; rec.invoiceStatus = status; saveState(state);
    pass('record-payment accepted and invoice status is PAID');
    return R('PASS', 'invoice PAID');
  }
  warn(`Invoice status after record-payment is "${status}", not PAID.`);
  if (r.ok) { rec.result = 'ok-unexpected-status'; saveState(state); return R('INCONCLUSIVE', `accepted but status ${status}`); }
  return R('INCONCLUSIVE', `status ${status}`);
}

// ---------------------------------------------------------------- F: Payout
function classifyPayout(j) {
  const bs = j?.batch_header?.batch_status;
  const item = j?.items?.[0];
  const ts = item?.transaction_status;
  if (ts === 'SUCCESS') return 'SUCCESS'; // only the ITEM status can prove money moved
  if (ts === 'UNCLAIMED') return 'UNCLAIMED';
  if (['FAILED', 'BLOCKED', 'RETURNED', 'REFUNDED', 'REVERSED'].includes(ts)) return 'FAILED';
  if (bs === 'DENIED') return 'DENIED';
  if (bs === 'CANCELED') return 'CANCELED';
  if (['PENDING', 'ONHOLD'].includes(ts) || ['PENDING', 'PROCESSING'].includes(bs) || !item) return 'PENDING';
  return 'UNKNOWN';
}

function payoutHint(e) {
  if (hasIssue(e, 'AUTHORIZATION_ERROR', 'NOT_AUTHORIZED', 'PERMISSION_DENIED') || e.status === 403 || e.status === 401) {
    info('Payouts looks UNAVAILABLE for this app/account. Check in the PayPal Developer Dashboard:');
    info('  - the app is a Merchant-type app attached to the platform BUSINESS sandbox account');
    info('  - any Payouts feature/permission for the app is enabled (Apps & Credentials -> your app -> features)');
  } else if (hasIssue(e, 'INSUFFICIENT_FUNDS')) {
    info('The platform Business sandbox balance is too low. Add sandbox funds or run a capture first.');
  } else if (hasIssue(e, 'SENDER_EMAIL_UNCONFIRMED')) {
    info('The sender (platform Business) account email is unconfirmed in the sandbox.');
  }
}

const batchIdFromLinks = (j) => {
  for (const l of j?.links ?? []) { const id = idFromHref(l?.href, /\/v1\/payments\/payouts\/([A-Za-z0-9]+)/); if (id) return id; }
};

async function stepPayout(state) {
  head('Step F - Payout from the platform merchant balance');
  const blockedF = identityBlock(state, 'Payout');
  if (blockedF) return blockedF;
  const { order: o, payout: p } = state;
  if (!o.verified) return R('SKIPPED', 'no verified capture, so no funds to pay out');

  p.senderBatchId ??= `brk-smoke-${state.runId}`;
  p.requestId ??= `brk-smoke-po-${state.runId}`;
  p.itemId ??= `brk-smoke-item-${state.runId}`;

  if (!p.batchId) {
    if (!p.attempted) {
      out(`  This will send a SANDBOX payout of ${PRICE} ${CURRENCY} to the configured SELLER account.`);
      if (!(await confirm('  Proceed with the sandbox payout?'))) return R('PAUSED', 'payout not confirmed');
    } else {
      info('A previous payout call was inconclusive. Retrying with the SAME sender_batch_id and request id (PayPal rejects/dedupes duplicates).');
    }
    p.attempted = true; saveState(state); // persist intent BEFORE the call
    const r = await pp('POST', '/v1/payments/payouts', {
      headers: { 'PayPal-Request-Id': p.requestId },
      body: {
        sender_batch_header: {
          sender_batch_id: p.senderBatchId,
          email_subject: 'SANDBOX TEST payout (Brokerage AI Gate 1)',
          email_message: 'Sandbox test only. Not real money.',
          recipient_type: 'EMAIL',
        },
        items: [{
          recipient_type: 'EMAIL',
          receiver: CFG.emails.seller,
          amount: { currency: CURRENCY, value: PRICE },
          note: 'SANDBOX TEST - Brokerage AI seller payout',
          sender_item_id: p.itemId,
          recipient_wallet: 'PAYPAL',
        }],
      },
    });
    if (r.ok) {
      p.batchId = r.json?.batch_header?.payout_batch_id;
      if (!p.batchId) { bad('Payout accepted but no batch id was returned. NOT retrying (could duplicate).'); return R('INCONCLUSIVE', 'no batch id'); }
      saveState(state);
      pass(`Payout batch accepted: ${p.batchId} (acceptance is NOT success - checking the item next)`);
    } else if (r.kind === 'rejected') {
      const e = safeErr(r);
      const existing = batchIdFromLinks(r.json);
      if (existing) {
        p.batchId = existing; saveState(state);
        warn(`PayPal says this sender_batch_id already exists; adopting original batch ${existing} (no new payout created).`);
      } else {
        p.attempted = false; saveState(state); // definitive rejection => nothing was created
        bad(`Payout REJECTED: ${fmtErr(e)}`);
        payoutHint(e);
        return R('FAIL', 'payout rejected');
      }
    } else {
      warn(`Payout call INCONCLUSIVE (${fmtErr(safeErr(r))}). A payout may or may not exist. Re-run: it will retry with identical ids, never a new one.`);
      return R('INCONCLUSIVE', 'payout call');
    }
  } else {
    info(`Resuming with payout batch ${p.batchId}; will only READ its status (never re-create).`);
  }

  let cls = 'PENDING';
  for (let i = 0; i < POLL_TRIES; i++) {
    const g = await pp('GET', `/v1/payments/payouts/${encodeURIComponent(p.batchId)}`);
    if (!g.ok) { warn(`Cannot read payout batch: ${fmtErr(safeErr(g))}`); cls = 'INCONCLUSIVE'; break; }
    cls = classifyPayout(g.json);
    const item = g.json?.items?.[0];
    p.batchStatus = g.json?.batch_header?.batch_status;
    p.itemStatus = item?.transaction_status;
    p.itemId = item?.payout_item_id ?? p.itemId;
    saveState(state);
    info(`batch_status=${p.batchStatus ?? '?'}  item_status=${p.itemStatus ?? '(no item yet)'}  -> ${cls}`);
    if (item?.errors) info(`item error: ${scrub(item.errors.name ?? '')} ${scrub(item.errors.message ?? '')}`);
    if (cls !== 'PENDING') break;
    if (i < POLL_TRIES - 1) await new Promise((res) => setTimeout(res, POLL_MS));
  }

  if (cls === 'SUCCESS') { p.final = 'SUCCESS'; saveState(state); pass('Payout item is SUCCESS: sandbox money reached the seller account.'); return R('SUCCESS', `batch ${p.batchId}`); }
  if (cls === 'UNCLAIMED') { p.final = 'UNCLAIMED'; saveState(state); warn('UNCLAIMED: the receiver email has no matching PayPal sandbox account. NOT a success.'); return R('UNCLAIMED', `batch ${p.batchId}`); }
  if (['FAILED', 'DENIED', 'CANCELED'].includes(cls)) { p.final = cls; saveState(state); bad(`Payout ${cls} (item=${p.itemStatus ?? '-'}, batch=${p.batchStatus ?? '-'}). NOT a success.`); return R(cls, `batch ${p.batchId}`); }
  warn(`Payout is ${cls}. Not reported as success. Re-run later to keep polling (no new payout will be created).`);
  return R(cls === 'PENDING' ? 'PENDING' : 'INCONCLUSIVE', `batch ${p.batchId}`);
}

// ------------------------------------------------------------------ summary
function printSummary(state, results) {
  head(`Summary - run ${state.runId} (SANDBOX)`);
  const rows = [
    ['A OAuth', results.A], ['B Invoice', results.B], ['C Order', results.C],
    ['D Capture + verify', results.D], ['E Record payment on invoice', results.E], ['F Payout', results.F],
  ];
  for (const [label, r] of rows) out(`  ${label.padEnd(30)} ${(r?.status ?? 'NOT RUN').padEnd(13)} ${scrub(r?.detail ?? '')}`);
  out('');
  const i = state.invoice, o = state.order, p = state.payout;
  out(`  IDs  invoice=${i.id ?? '-'}  order=${o.id ?? '-'}  capture=${o.captureId ?? '-'}  payout_batch=${p.batchId ?? '-'}`);
  out(`  Amounts  price=${PRICE}  fee=${FEE}  buyer_total=${TOTAL}  seller_payout=${PRICE} (${CURRENCY})`);
  out(`  Identity checks  ${identityLine(state)}`);
  if (Object.values(state.identity ?? {}).includes('UNAVAILABLE')) out('  NOTE: UNAVAILABLE = PayPal did not return that field; that identity was NOT independently verified.');
  if (identityMismatches(state).length) out('  FINDING: identity MISMATCH recorded. Workflow stopped; nothing further will run until --fresh.');
  if (results.E?.status === 'REJECTED') out('\n  FINDING: record-payment was rejected -> recommend ORDERS-ONLY for the app (no invoice).');
  if (results.F && ['UNCLAIMED', 'FAILED', 'DENIED', 'CANCELED'].includes(results.F.status)) out('  FINDING: payout did NOT succeed (see Step F).');
  out(`  State file: ${STATE_PATH.replace(/^.*[\\/]/, '')} (gitignored; contains IDs only)`);
}

function exitCodeFor(results) {
  const r = results;
  const fatal = ['FAIL'];
  if (Object.values(r).some((x) => fatal.includes(x?.status))) return EXIT.FAIL;
  if (['A', 'B', 'C', 'D'].some((k) => r[k]?.status !== 'PASS')) return EXIT.PAUSED;
  if (!['PASS', 'REJECTED'].includes(r.E?.status)) return EXIT.PAUSED;
  if (r.F?.status === 'SUCCESS') return EXIT.OK;
  if (['UNCLAIMED', 'FAILED', 'DENIED', 'CANCELED'].includes(r.F?.status)) return EXIT.FAIL;
  return EXIT.PAUSED;
}

// ---------------------------------------------------------------------- main
function usage() {
  out(`Brokerage AI - PayPal SANDBOX smoke test (Gate 1)

  node --env-file=.env.local scripts/paypal-sandbox-smoke.mjs [flags]

  (no flag)              start a new run, or RESUME the run saved in .paypal-smoke-state.json
  --status               print the saved run's progress (no API calls, no credentials needed)
  --fresh                discard the saved run and start a new one
  --confirm-new-payout   required with --fresh if the saved run already initiated a payout
  --retry-record         retry Step E after PayPal rejected it
  --probe-duplicates     also test whether PayPal rejects a duplicate invoice_number
  --yes                  skip y/N confirmations (the buyer approval pause still happens)
  --help                 this text

  Exit codes: 0 all steps conclusive+successful, 1 a step failed, 2 paused/pending/inconclusive, 3 config error`);
}

async function main() {
  for (const a of argv) if (!KNOWN_FLAGS.has(a)) configError(`Unknown flag: ${a} (use --help)`);
  if (FLAGS.help) return usage();

  let state = loadState();

  if (FLAGS.status) {
    if (!state) return out('No saved run.');
    out(`Run ${state.runId} (${state.environment}), started ${state.createdAt}`);
    for (const [k, v] of Object.entries(state.results)) out(`  ${k}: ${v}`);
    out(`  invoice=${state.invoice.id ?? '-'} order=${state.order.id ?? '-'} capture=${state.order.captureId ?? '-'} payout_batch=${state.payout.batchId ?? '-'} payout_final=${state.payout.final ?? '-'}`);
    out(`  identity: ${identityLine(state)}`);
    return;
  }

  CFG = loadConfig(); // fails closed unless PAYPAL_ENVIRONMENT=SANDBOX

  if (FLAGS.fresh && state) {
    if (state.payout?.attempted && !FLAGS.confirmNewPayout) {
      configError(
        `The saved run (${state.runId}) already initiated a payout (batch ${state.payout.batchId ?? 'unknown'}). ` +
          'Starting fresh would send another one. If that is intended, re-run with: --fresh --confirm-new-payout'
      );
    }
    out(`Discarding saved run ${state.runId}. Objects it created remain in the sandbox: invoice=${state.invoice.id ?? '-'} order=${state.order.id ?? '-'} payout=${state.payout.batchId ?? '-'}`);
    unlinkSync(STATE_PATH);
    state = null;
  }

  out('============================================================');
  out(' SANDBOX SMOKE TEST - no real money. Sandbox host only.');
  out('============================================================');
  out(`Accounts configured: platform=set buyer=set seller=set (three distinct; values not shown)`);

  if (state) {
    if (state.environment !== 'SANDBOX') configError('Saved state is not marked SANDBOX. Refusing.');
    if (state.fingerprint !== CFG.fingerprint) {
      configError('The configured account emails changed since this run started. Use --fresh (or restore the original values) so a payout cannot go to a different recipient mid-run.');
    }
    if (state.completedAt) {
      out(`\nRun ${state.runId} is already COMPLETE (${state.completedAt}). Nothing will be repeated.`);
      for (const [k, v] of Object.entries(state.results)) out(`  ${k}: ${v}`);
      out(`  invoice=${state.invoice.id ?? '-'} order=${state.order.id ?? '-'} capture=${state.order.captureId ?? '-'} payout_batch=${state.payout.batchId ?? '-'} payout_final=${state.payout.final ?? '-'}`);
      out(`  identity: ${identityLine(state)}`);
      return out('\nUse --fresh to start a new run.');
    }
    out(`Resuming run ${state.runId}`);
  } else {
    out(`\nNew run. Test amounts: product ${PRICE} + 3% fee ${FEE} = buyer total ${TOTAL} ${CURRENCY}; seller payout ${PRICE}.`);
    if (!(await confirm('Create a new SANDBOX test run?'))) exitNow(EXIT.PAUSED, 'Not confirmed. Nothing was created.');
    state = newState(CFG.fingerprint);
    saveState(state);
  }

  const results = {};
  const steps = [
    ['A', () => stepAuth(state)], ['B', () => stepInvoice(state)], ['C', () => stepOrder(state)],
    ['D', () => stepCapture(state)], ['E', () => stepRecord(state)], ['F', () => stepPayout(state)],
  ];
  for (const [key, fn] of steps) {
    results[key] = await fn();
    state.results[key] = results[key].status + (results[key].detail ? ` - ${scrub(results[key].detail)}` : '');
    saveState(state);
    // E (record payment) is an experiment: its rejection must not block the payout test.
    const stop = key !== 'E' && results[key].status !== 'PASS' && results[key].status !== 'SUCCESS';
    if (stop && key !== 'F') break;
  }

  const code = exitCodeFor(results);
  const terminalF = ['SUCCESS', 'UNCLAIMED', 'FAILED', 'DENIED', 'CANCELED'].includes(results.F?.status);
  if (terminalF && ['PASS', 'REJECTED'].includes(results.E?.status)) { state.completedAt = new Date().toISOString(); saveState(state); }
  printSummary(state, results);
  if (code === EXIT.PAUSED) out('\nPAUSED / not yet conclusive. Re-run the same command to continue; nothing completed will be repeated.');
  process.exit(code);
}

main().catch((e) => {
  console.error(`\nUNEXPECTED ERROR: ${scrub(e?.message ?? e)}`);
  process.exit(EXIT.FAIL);
});
