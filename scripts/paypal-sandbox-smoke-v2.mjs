#!/usr/bin/env node
/**
 * Brokerage AI - PayPal SANDBOX smoke test v2 (Gate 1, NO PayPal Invoicing)
 *
 * Standalone, dependency-free, interactive, resumable. SANDBOX ONLY: the one API host is
 * BASE_URL below and the script refuses to run unless PAYPAL_ENVIRONMENT is exactly "SANDBOX".
 * It never reads, writes or deletes the v1 state file (.paypal-smoke-state.json).
 *
 * Two workflows, deliberately kept separate (a run is locked to one mode):
 *   --mode=delayed   PayPal Commerce Platform / Complete Payments: Orders with payee +
 *                    disbursement_mode DELAYED + platform_fees, then Referenced Payouts.
 *                    Needs partner capabilities. NOT assumed available.
 *   --mode=fallback  Plain Orders capture into the platform account, then standard Payouts.
 *                    This is NOT PayPal-native delayed disbursement.
 * Default action (no mode): --diagnose, read-only.   See scripts/PAYPAL_SMOKE_V2.md
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

// ---------------------------------------------------------------- constants
const BASE_URL = "https://api-m.sandbox.paypal.com"; // the ONLY host this script talks to
const V1_STATE_PATH = fileURLToPath(
  new URL("../.paypal-smoke-state.json", import.meta.url),
);
let STATE_PATH = fileURLToPath(
  new URL("../.paypal-smoke-state.v2.json", import.meta.url),
);
const CURRENCY = "USD";
const PRICE_CENTS = 500; // seller amount $5.00
const FEE_CENTS = Math.round((PRICE_CENTS * 3) / 100); // 3% platform fee (integer math)
const TOTAL_CENTS = PRICE_CENTS + FEE_CENTS; // buyer pays $5.15
const money = (c) => (c / 100).toFixed(2);
const PRICE = money(PRICE_CENTS);
const FEE = money(FEE_CENTS);
const TOTAL = money(TOTAL_CENTS);
const TIMEOUT_MS = 30_000;
const POLL_TRIES = 12;
const EXIT = { OK: 0, FAIL: 1, PAUSED: 2, CONFIG: 3 };
const KNOWN_FLAGS = [
  "--help",
  "--status",
  "--diagnose",
  "--yes",
  "--confirm-retry-release",
  "--new-run",
];
const KNOWN_VALUE_FLAGS = ["--mode", "--window"];
const COMMON_ENV = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_SECRET",
  "PAYPAL_ENVIRONMENT",
  "PAYPAL_PLATFORM_BUSINESS_EMAIL",
  "PAYPAL_SMOKE_BUYER_EMAIL",
  "PAYPAL_SMOKE_SELLER_EMAIL",
];
const DELAYED_ENV = ["PAYPAL_SMOKE_SELLER_MERCHANT_ID"];
const OPTIONAL_ENV = [
  "PAYPAL_PLATFORM_MERCHANT_ID",
  "PAYPAL_SMOKE_BUYER_PAYER_ID",
  "PAYPAL_PARTNER_ATTRIBUTION_ID",
  "PAYPAL_PARTNER_MERCHANT_ID",
];

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}
let FLAGS = {};
let CFG = null;
let cachedToken = null;
let tokenScope = "";
let SCRUB_VALUES = [];
let ANSWERS = null; // test hook only (see __test)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollMs = () => Number(process.env.PAYPAL_SMOKE_POLL_MS) || 5000;

// ------------------------------------------------------ safe output / scrub
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_RE = /https?:\/\/[^\s"')\]]+/g;
function scrub(text) {
  let s = String(text ?? "");
  for (const v of SCRUB_VALUES) if (v) s = s.split(v).join("[redacted]");
  return s.replace(URL_RE, "[url]").replace(EMAIL_RE, "[email]");
}
const out = (m = "") => console.log(m);
const info = (m) => out(`    ${m}`);
const pass = (m) => out(`  [PASS] ${m}`);
const warn = (m) => out(`  [WARN] ${m}`);
const bad = (m) => out(`  [FAIL] ${m}`);
const head = (m) => out(`\n=== ${m}`);
const R = (status, detail = "") => ({ status, detail });
const exitNow = (code, msg) => {
  if (msg) out(`\n${msg}`);
  throw new Exit(code);
};
const configError = (msg) => exitNow(EXIT.CONFIG, `CONFIG ERROR: ${msg}`);

// ------------------------------------------------------------------- config
const envOf = (k) => (process.env[k] ?? "").trim();
function loadConfig(mode) {
  if (envOf("PAYPAL_ENVIRONMENT") !== "SANDBOX")
    configError(
      'PAYPAL_ENVIRONMENT must be exactly "SANDBOX". Refusing to run.',
    );
  const need =
    mode === "delayed" ? [...COMMON_ENV, ...DELAYED_ENV] : COMMON_ENV;
  const missing = need.filter((k) => !envOf(k));
  if (missing.length)
    configError(
      `Missing environment variables (names only): ${missing.join(", ")}`,
    );
  const clientId = envOf("PAYPAL_CLIENT_ID");
  const secret = envOf("PAYPAL_SECRET");
  if (/^your-/i.test(clientId) || /^your-/i.test(secret))
    configError(
      "PAYPAL_CLIENT_ID / PAYPAL_SECRET still look like .env.example placeholders.",
    );
  const emails = {
    platform: envOf("PAYPAL_PLATFORM_BUSINESS_EMAIL").toLowerCase(),
    buyer: envOf("PAYPAL_SMOKE_BUYER_EMAIL").toLowerCase(),
    seller: envOf("PAYPAL_SMOKE_SELLER_EMAIL").toLowerCase(),
  };
  for (const [role, e] of Object.entries(emails)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      configError(`The ${role} email variable is not a valid email address.`);
  }
  if (new Set(Object.values(emails)).size !== 3)
    configError(
      "Platform, buyer and seller emails must be three DIFFERENT Sandbox accounts.",
    );
  const ids = {
    seller: envOf("PAYPAL_SMOKE_SELLER_MERCHANT_ID"),
    platform: envOf("PAYPAL_PLATFORM_MERCHANT_ID"),
    buyer: envOf("PAYPAL_SMOKE_BUYER_PAYER_ID"),
    partner: envOf("PAYPAL_PARTNER_MERCHANT_ID"),
  };
  for (const [k, v] of Object.entries(ids)) {
    if (v && !/^[A-Za-z0-9]{8,20}$/.test(v))
      configError(
        `The ${k} merchant/payer ID variable has an unexpected format.`,
      );
  }
  const bn = envOf("PAYPAL_PARTNER_ATTRIBUTION_ID");
  if (bn && !/^[\w.-]{1,36}$/.test(bn))
    configError(
      "PAYPAL_PARTNER_ATTRIBUTION_ID has an unexpected format (1-36 chars).",
    );
  let assertion = "";
  if (mode === "delayed") {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
    assertion = `${b64({ alg: "none" })}.${b64({ iss: clientId, payer_id: ids.seller })}.`;
  }
  SCRUB_VALUES = [
    secret,
    clientId,
    assertion,
    ...Object.values(emails),
    ...Object.values(ids),
    bn,
  ].filter(Boolean);
  const fingerprint = createHash("sha256")
    .update([mode, ...Object.values(emails), ...Object.values(ids)].join("|"))
    .digest("hex")
    .slice(0, 16);
  return { clientId, secret, emails, ids, bn, assertion, fingerprint };
}

// -------------------------------------------------------------- state file
// Identifiers and progress only. Never tokens, secrets, emails or raw merchant/payer IDs.
function assertV2Path(p) {
  if (p === V1_STATE_PATH || !p.endsWith(".json") || !/\.v2/.test(p)) {
    throw new Error(
      "internal: refusing to touch a state path that is not a v2 file",
    );
  }
}
function loadState() {
  assertV2Path(STATE_PATH);
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    configError(
      `v2 state file is unreadable. Inspect it deliberately: ${STATE_PATH}`,
    );
  }
}
function saveState(state) {
  assertV2Path(STATE_PATH);
  state.updatedAt = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}
function newState(mode, fingerprint) {
  return {
    version: 2,
    environment: "SANDBOX",
    mode,
    runId: randomBytes(6).toString("hex"),
    createdAt: new Date().toISOString(),
    fingerprint,
    amounts: {
      priceCents: PRICE_CENTS,
      feeCents: FEE_CENTS,
      totalCents: TOTAL_CENTS,
      currency: CURRENCY,
    },
    diagnosis: {},
    order: {},
    capture: {},
    window: {},
    release: {},
    identity: {},
    results: {},
    completedAt: null,
  };
}

// --------------------------------------------------------------------- HTTP
const kindOf = (s) =>
  s >= 200 && s < 300
    ? "ok"
    : s === 408 || s === 429 || s >= 500
      ? "inconclusive"
      : "rejected";

async function rawRequest(method, path, { headers = {}, body, form } = {}) {
  if (!path.startsWith("/"))
    throw new Error('internal: path must start with "/"');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const h = { Accept: "application/json", ...headers };
    let payload;
    if (form !== undefined) {
      h["Content-Type"] = "application/x-www-form-urlencoded";
      payload = form;
    } else if (body !== undefined) {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE_URL + path, {
      method,
      headers: h,
      body: payload,
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, ok: res.ok, json, kind: kindOf(res.status) };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      json: null,
      kind: "inconclusive",
      network: e?.name === "AbortError" ? "timeout" : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}
async function fetchToken() {
  const basic = Buffer.from(`${CFG.clientId}:${CFG.secret}`).toString("base64");
  const r = await rawRequest("POST", "/v1/oauth2/token", {
    headers: { Authorization: `Basic ${basic}` },
    form: "grant_type=client_credentials",
  });
  if (!r.ok || !r.json?.access_token) return { ok: false, r };
  cachedToken = r.json.access_token;
  tokenScope = typeof r.json.scope === "string" ? r.json.scope : "";
  SCRUB_VALUES.push(cachedToken);
  return { ok: true };
}
async function pp(method, path, opts = {}) {
  if (!cachedToken) {
    const t = await fetchToken();
    if (!t.ok) return t.r;
  }
  const withAuth = () => ({
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${cachedToken}`,
    },
  });
  let r = await rawRequest(method, path, withAuth());
  if (r.status === 401 && cachedToken) {
    // token expired mid-run: refresh once
    cachedToken = null;
    const t = await fetchToken();
    if (!t.ok) return t.r;
    r = await rawRequest(method, path, withAuth());
  }
  return r;
}
/** Partner headers: attribution id when configured; auth assertion for delayed-mode order calls. */
const partnerHeaders = ({ assertion = false } = {}) => ({
  ...(CFG.bn ? { "PayPal-Partner-Attribution-Id": CFG.bn } : {}),
  ...(assertion && CFG.assertion
    ? { "PayPal-Auth-Assertion": CFG.assertion }
    : {}),
});
function safeErr(r) {
  if (r.network) return { status: 0, network: r.network };
  const j = r.json ?? {};
  return {
    status: r.status,
    name: j.name ?? j.error ?? undefined,
    message: scrub(j.message ?? j.error_description ?? ""),
    issues: (Array.isArray(j.details) ? j.details : [])
      .slice(0, 5)
      .map((d) => ({
        issue: d.issue,
        field: d.field,
        description: scrub(d.description ?? ""),
      })),
    debug_id: j.debug_id,
  };
}
function fmtErr(e) {
  if (e.network) return `no usable response (${e.network})`;
  const issues = (e.issues ?? [])
    .map((i) =>
      [i.issue, i.field && `field=${i.field}`, i.description]
        .filter(Boolean)
        .join(" "),
    )
    .join(" | ");
  return [
    `HTTP ${e.status}`,
    e.name,
    e.message,
    issues && `[${issues}]`,
    e.debug_id && `debug_id=${e.debug_id}`,
  ]
    .filter(Boolean)
    .join(" - ");
}
const hasIssue = (e, ...names) =>
  (e.issues ?? []).some((i) => names.includes(i.issue)) ||
  names.includes(e.name);

// ---------------------------------------------------------------- prompting
async function ask(q) {
  if (ANSWERS) return ANSWERS.length ? ANSWERS.shift() : null;
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await rl.question(q)).trim();
  } finally {
    rl.close();
  }
}
const confirm = async (q) => {
  if (FLAGS.yes) return true;
  const a = await ask(`${q} [y/N] `);
  return a !== null && a.toLowerCase() === "y";
};
/** Money-moving confirmation: --yes does NOT bypass it. Must type the word "yes". */
const confirmStrict = async (q) => {
  const a = await ask(`${q} Type "yes" to proceed: `);
  return a !== null && a.toLowerCase() === "yes";
};

// ------------------------------------------------- identity (fail closed)
// Only the words MATCH / MISMATCH / UNAVAILABLE (and which basis matched) are printed or stored.
const norm = (v) => (typeof v === "string" ? v.trim() : "");
function cmp(seenRaw, wantRaw, ci) {
  const f = (v) => (ci ? norm(v).toLowerCase() : norm(v));
  const seen = seenRaw.map(f).filter(Boolean);
  const want = f(wantRaw);
  if (!seen.length || !want) return "UNAVAILABLE";
  return seen.every((v) => v === want) ? "MATCH" : "MISMATCH"; // any conflicting value => MISMATCH
}
const sha = (v) =>
  createHash("sha256").update(String(v)).digest("hex").slice(0, 12);
const LABEL = { payee: "Payee (who the money is for)", payer: "Payer (buyer)" };
function identityOf(kind, doc, state) {
  const pu = doc?.purchase_units?.[0];
  let em, id, wantEmail, wantId;
  if (kind === "payee") {
    em = [pu?.payee?.email_address];
    id = [pu?.payee?.merchant_id];
    wantEmail =
      state.mode === "delayed" ? CFG.emails.seller : CFG.emails.platform;
    wantId = state.mode === "delayed" ? CFG.ids.seller : CFG.ids.platform;
  } else {
    em = [
      doc?.payment_source?.paypal?.email_address,
      doc?.payer?.email_address,
    ];
    id = [doc?.payment_source?.paypal?.account_id, doc?.payer?.payer_id];
    wantEmail = CFG.emails.buyer;
    wantId = CFG.ids.buyer;
  }
  const byEmail = cmp(em, wantEmail, true);
  let byId = cmp(id, wantId, false);
  if (kind === "payer") {
    // no configured payer id: pin the first one seen; a later different id is a MISMATCH
    const seen = id.map(norm).filter(Boolean);
    if (seen.length && !wantId) {
      const h = sha(seen[0]);
      if (seen.some((v) => sha(v) !== h)) byId = "MISMATCH";
      else if (!state.identity.payerPin) {
        state.identity.payerPin = h;
        byId = "UNAVAILABLE";
      } else byId = state.identity.payerPin === h ? "MATCH" : "MISMATCH";
    }
  }
  const all = [byEmail, byId];
  const status = all.includes("MISMATCH")
    ? "MISMATCH"
    : all.includes("MATCH")
      ? "MATCH"
      : "UNAVAILABLE";
  const basis = [
    byEmail === "MATCH" && "email",
    byId === "MATCH" && "id",
  ].filter(Boolean);
  return { status, basis };
}
function recordIdentity(state, kind, res) {
  state.identity ??= {};
  if (state.identity[kind]?.status === "MISMATCH") return "MISMATCH"; // sticky
  state.identity[kind] = res;
  saveState(state);
  return res.status;
}
function reportIdentity(kind, status, basis = []) {
  if (status === "MATCH")
    pass(
      `${LABEL[kind]} matches the configured account (basis: ${basis.join("+") || "n/a"}${basis.length === 1 && basis[0] === "email" ? "; email only, weaker" : ""})`,
    );
  else if (status === "MISMATCH")
    bad(
      `${LABEL[kind]} CONFLICTS with the configured account (values not shown). STOPPING.`,
    );
  else
    out(
      `  [UNAVAILABLE] ${LABEL[kind]}: PayPal did not return a comparable value, so it is NOT independently verified.`,
    );
}
const mismatches = (s) =>
  ["payee", "payer"].filter((k) => s.identity?.[k]?.status === "MISMATCH");
function identityBlock(state, what) {
  const m = mismatches(state);
  if (!m.length) return null;
  bad(
    `An identity mismatch was recorded earlier (${m.join(", ")}). ${what} refused. Fix the configuration and start a new run (--new-run).`,
  );
  return R("FAIL", `identity mismatch: ${m.join(", ")}`);
}
const identityLine = (s) =>
  ["payee", "payer"]
    .map(
      (k) =>
        `${k}=${s.identity?.[k]?.status ?? "-"}${s.identity?.[k]?.basis?.length ? `(${s.identity[k].basis.join("+")})` : ""}`,
    )
    .join("  ");

// -------------------------------------------------------------- A: OAuth
async function stepAuth() {
  head("Step A - OAuth (Sandbox)");
  const t = await fetchToken();
  if (!t.ok) {
    bad(`OAuth failed: ${fmtErr(safeErr(t.r))}`);
    info("Check that the credentials belong to a SANDBOX app (not Live).");
    return R("FAIL", "oauth");
  }
  pass("Access token obtained (memory only, never printed or stored)");
  const has = (s) => tokenScope.toLowerCase().includes(s);
  info(
    `Token scope hints (hints only, NOT proof of eligibility): partner=${has("partner") ? "yes" : "no"} payouts=${has("payouts") ? "yes" : "no"} referenced-payouts=${has("referenced") ? "yes" : "no"}`,
  );
  return R("PASS");
}

// ----------------------------------------- B: seller status (read-only, optional)
async function stepSellerStatus(state) {
  head("Step B - Seller onboarding status (read-only, optional)");
  if (!CFG.ids.partner || !CFG.ids.seller) {
    info(
      "Skipped: set PAYPAL_PARTNER_MERCHANT_ID and PAYPAL_SMOKE_SELLER_MERCHANT_ID to enable.",
    );
    return R("SKIPPED", "not configured");
  }
  const r = await pp(
    "GET",
    `/v1/customer/partners/${encodeURIComponent(CFG.ids.partner)}/merchant-integrations/${encodeURIComponent(CFG.ids.seller)}`,
    { headers: partnerHeaders() },
  );
  if (!r.ok) {
    warn(`Seller status not readable: ${fmtErr(safeErr(r))}`);
    if (state) {
      state.diagnosis.sellerStatus = `unreadable (HTTP ${r.status})`;
      saveState(state);
    }
    return R("UNAVAILABLE", `HTTP ${r.status}`);
  }
  const j = r.json ?? {};
  const raw = JSON.stringify(j);
  const idMatch = cmp([j.merchant_id], CFG.ids.seller, false);
  info(`merchant_id vs configured seller: ${idMatch}`);
  info(
    `payments_receivable=${j.payments_receivable ?? "?"}  primary_email_confirmed=${j.primary_email_confirmed ?? "?"}`,
  );
  info(
    `feature words in response (not conclusive): DELAY_FUNDS_DISBURSEMENT=${raw.includes("DELAY_FUNDS_DISBURSEMENT") ? "seen" : "not seen"}  PARTNER_FEE=${raw.includes("PARTNER_FEE") ? "seen" : "not seen"}`,
  );
  if (state) {
    state.diagnosis.sellerStatus = {
      idMatch,
      receivable: j.payments_receivable ?? null,
      emailConfirmed: j.primary_email_confirmed ?? null,
    };
    saveState(state);
  }
  if (idMatch === "MISMATCH") {
    bad(
      "Seller merchant ID returned by PayPal does not match the configured one. STOPPING.",
    );
    return R("FAIL", "seller id mismatch");
  }
  return R("PASS", "read-only status obtained");
}

// ------------------------------------------------------- C: Orders (create)
const approvalLink = (o) =>
  (o?.links ?? []).find((l) => l.rel === "payer-action" || l.rel === "approve")
    ?.href;
const orderHeaders = (state) =>
  partnerHeaders({ assertion: state.mode === "delayed" });
const getOrder = (state, id) =>
  pp("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`, {
    headers: orderHeaders(state),
  });

function orderBody(state) {
  const price = { currency_code: CURRENCY, value: PRICE };
  const fee = { currency_code: CURRENCY, value: FEE };
  const pu = {
    reference_id: `smoke-${state.runId}`,
    custom_id: state.order.customId,
    description: "Brokerage AI SANDBOX smoke test",
    amount: {
      currency_code: CURRENCY,
      value: TOTAL,
      breakdown: { item_total: { currency_code: CURRENCY, value: TOTAL } },
    },
    items: [
      {
        name: "SANDBOX TEST - product",
        quantity: "1",
        unit_amount: price,
        category: "DIGITAL_GOODS",
      },
      {
        name: "SANDBOX TEST - platform fee (3%)",
        quantity: "1",
        unit_amount: fee,
        category: "DIGITAL_GOODS",
      },
    ],
  };
  if (state.mode === "delayed") {
    pu.payee = { merchant_id: CFG.ids.seller };
    pu.payment_instruction = {
      disbursement_mode: "DELAYED",
      platform_fees: [{ amount: fee }],
    };
  }
  return {
    intent: "CAPTURE",
    purchase_units: [pu],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: "https://example.com/paypal-smoke/return",
          cancel_url: "https://example.com/paypal-smoke/cancel",
        },
      },
    },
  };
}

function classifyDelayedRejection(e) {
  if (e.status === 401)
    return [
      "PARTNER_AUTH",
      "HTTP 401: PayPal says this app/credential is not authorized for the partner APIs (docs: unapproved partner calls return 401). Use a Platform REST app created under the sandbox API caller account.",
    ];
  if (hasIssue(e, "PAYEE_NOT_CONSENTED"))
    return [
      "SELLER_NO_CONSENT",
      "The seller has not granted this platform permission (onboarding with DELAY_FUNDS_DISBURSEMENT and PARTNER_FEE not completed for this seller).",
    ];
  if (
    hasIssue(
      e,
      "PAYEE_ACCOUNT_INVALID",
      "PAYEE_ACCOUNT_RESTRICTED",
      "PAYEE_ACCOUNT_LOCKED_OR_CLOSED",
    )
  )
    return [
      "SELLER_ACCOUNT",
      "PayPal rejected the seller account as payee (invalid/restricted/closed).",
    ];
  if (
    e.status === 403 ||
    hasIssue(e, "NOT_AUTHORIZED", "PERMISSION_DENIED", "AUTHORIZATION_ERROR")
  )
    return [
      "PERMISSION",
      "Permission denied: the app, the seller onboarding, or the partner features (DELAY_FUNDS_DISBURSEMENT / PARTNER_FEE) are not enabled for this combination.",
    ];
  return [
    "OTHER",
    "Rejected for a reason this script cannot classify as a capability problem. Read the issue above.",
  ];
}

async function stepOrder(state) {
  head(
    `Step C - Orders API (${state.mode === "delayed" ? "DELAYED disbursement, platform fee" : "plain order, fallback"})`,
  );
  const o = state.order;
  o.customId ??= `smoke-${state.runId}`;
  o.requestId ??= `brk-smoke2-order-${state.runId}`;
  o.captureRequestId ??= `brk-smoke2-cap-${state.runId}`;
  if (!o.id) {
    o.createAttempted = true;
    saveState(state); // persist intent BEFORE the call
    const r = await pp("POST", "/v2/checkout/orders", {
      body: orderBody(state),
      headers: {
        ...orderHeaders(state),
        "PayPal-Request-Id": o.requestId,
        Prefer: "return=representation",
      },
    });
    if (!r.ok) {
      const e = safeErr(r);
      if (r.kind === "rejected") {
        o.createAttempted = false;
        saveState(state);
        bad(`Order create rejected: ${fmtErr(e)}`);
        if (state.mode === "delayed") {
          const [code, why] = classifyDelayedRejection(e);
          state.diagnosis.delayedCapability = {
            status: "UNAVAILABLE",
            code,
            httpStatus: e.status,
            at: new Date().toISOString(),
          };
          saveState(state);
          info(why);
          info(
            "No money moved. Preferred (delayed-disbursement) workflow is BLOCKED for this setup. Diagnostics are saved in the v2 state.",
          );
          info(
            "Safe fallback (NOT marketplace delayed disbursement): node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --new-run --mode=fallback",
          );
        }
        return R("FAIL", "order create rejected");
      }
      warn(
        `Order create INCONCLUSIVE (${fmtErr(e)}). Re-run: it retries with the SAME PayPal-Request-Id, so it cannot create a second order.`,
      );
      return R("INCONCLUSIVE", "order create");
    }
    o.id = r.json?.id;
    o.createAttempted = false;
    if (!o.id) {
      bad("Order created but no ID in the response.");
      return R("FAIL", "no order id");
    }
    saveState(state);
    pass(
      `Order created: ${o.id} (CAPTURE intent, ${TOTAL} ${CURRENCY}${state.mode === "delayed" ? `, DELAYED, platform fee ${FEE}` : ""}). Created is NOT paid.`,
    );
    if (state.mode === "delayed")
      state.diagnosis.delayedCapability = {
        status: "ORDER_ACCEPTED",
        at: new Date().toISOString(),
      };
    saveState(state);
  } else info(`Resuming with order ${o.id}`);

  for (;;) {
    const g = await getOrder(state, o.id);
    if (!g.ok) {
      warn(`Cannot read order: ${fmtErr(safeErr(g))}`);
      return R("INCONCLUSIVE", "order read");
    }
    const status = g.json?.status;
    o.status = status;
    saveState(state);
    if (status === "APPROVED" || status === "COMPLETED") {
      pass(`Order status: ${status}`);
      return R("PASS", `${o.id} ${status}`);
    }
    if (status === "VOIDED") {
      bad(
        "Order is VOIDED (expired or cancelled). Start a new run (--new-run).",
      );
      return R("FAIL", "order voided");
    }
    out("");
    out(
      "  ACTION REQUIRED - approve this SANDBOX order as the BUYER (Personal) account:",
    );
    out("    1. Open this URL in a private/incognito browser window:");
    out(
      `       ${approvalLink(g.json) ?? "(no approval link returned - re-run to refetch)"}`,
    );
    out("    2. Log in with the Sandbox PERSONAL (buyer) account and approve.");
    out(
      "    3. You will be redirected to example.com - expected. Come back here.",
    );
    const a = await ask("  Press Enter once approved (or type q to pause): ");
    if (a === null)
      return R("PAUSED", "awaiting buyer approval (re-run after approving)");
    if (a.toLowerCase() === "q") return R("PAUSED", "paused by user");
  }
}

// --------------------------------------------------- D: Capture and verify
function verifyOrder(state, order) {
  const o = state.order;
  const pu = order?.purchase_units?.[0];
  const caps = pu?.payments?.captures ?? [];
  const cap = caps[0];
  const checks = [
    [order?.id === o.id, "order id matches"],
    [
      order?.status === "COMPLETED",
      `order status COMPLETED (got ${order?.status})`,
    ],
    [order?.intent === "CAPTURE", `intent CAPTURE (got ${order?.intent})`],
    [pu?.custom_id === o.customId, "custom_id matches our internal reference"],
    [
      pu?.amount?.value === TOTAL && pu?.amount?.currency_code === CURRENCY,
      `order amount ${TOTAL} ${CURRENCY}`,
    ],
    [caps.length === 1, `exactly one capture (got ${caps.length})`],
    [
      cap?.status === "COMPLETED",
      `capture status COMPLETED (got ${cap?.status})`,
    ],
    [
      cap?.amount?.value === TOTAL && cap?.amount?.currency_code === CURRENCY,
      `captured amount ${TOTAL} ${CURRENCY}`,
    ],
    [
      typeof cap?.id === "string" && cap.id.length > 0 && cap.id.length <= 22,
      "capture id present and within 22 chars",
    ],
  ];
  const hold =
    cap?.disbursement_mode ?? pu?.payment_instruction?.disbursement_mode;
  const brk = cap?.seller_receivable_breakdown;
  const feeSeen = brk?.platform_fees?.[0]?.amount?.value;
  if (state.mode === "delayed") {
    if (hold !== undefined)
      checks.push([
        hold === "DELAYED",
        `disbursement_mode is DELAYED (got ${hold}); INSTANT would mean funds were NOT held`,
      ]);
    if (feeSeen !== undefined)
      checks.push([
        feeSeen === FEE,
        `platform fee on the capture is ${FEE} (got ${feeSeen})`,
      ]);
  }
  return {
    checks,
    cap,
    hold,
    brk,
    feeSeen,
    pending: cap?.status === "PENDING",
    allOk: checks.every(([c]) => c),
  };
}

async function stepCapture(state) {
  head("Step D - Identity check, capture, verify");
  const blocked = identityBlock(state, "Capture step");
  if (blocked) return blocked;
  const o = state.order;
  if (!o.verified) {
    const g = await getOrder(state, o.id);
    if (!g.ok) return R("INCONCLUSIVE", "order read");
    if (g.json?.status === "APPROVED") {
      // Fail closed BEFORE any money moves, using whatever identity PayPal already exposes.
      const pre = ["payee", "payer"]
        .map((k) => [k, identityOf(k, g.json, state)])
        .map(([k, r]) => [k, r, recordIdentity(state, k, r)]);
      for (const [k, r, st] of pre) reportIdentity(k, st, r.basis);
      if (pre.some(([, , st]) => st === "MISMATCH")) {
        info(
          "Order was NOT captured: no money moved. Nothing further will run.",
        );
        return R("FAIL", "identity mismatch before capture");
      }
      const pu = g.json?.purchase_units?.[0];
      const preHold = pu?.payment_instruction?.disbursement_mode;
      if (state.mode === "delayed") {
        if (preHold !== undefined && preHold !== "DELAYED") {
          bad(
            `Order shows disbursement_mode ${preHold}, not DELAYED. Refusing to capture (funds would not be held).`,
          );
          return R("FAIL", "order not DELAYED");
        }
        info(
          `Pre-capture hold configuration: ${preHold === "DELAYED" ? "DELAYED (confirmed by PayPal)" : "not echoed by PayPal (UNVERIFIED; checked again after capture)"}`,
        );
      }
      if (pre.some(([, , st]) => st === "UNAVAILABLE"))
        info(
          "Some identities are UNAVAILABLE before capture; they are re-checked after capture.",
        );
      out(
        `\n  ABOUT TO MOVE SANDBOX MONEY: capture order ${o.id} for ${TOTAL} ${CURRENCY} from the buyer account.`,
      );
      if (state.mode === "delayed")
        out(
          `  Mode delayed: funds should be HELD by PayPal for the seller (amount ${TOTAL}, platform fee ${FEE}).`,
        );
      else
        out(
          "  Mode fallback: funds land in the PLATFORM account (not marketplace delayed disbursement).",
        );
      if (!(await confirmStrict("  Capture now?")))
        return R("PAUSED", "capture not confirmed");
      o.captureAttempted = true;
      saveState(state); // persist intent BEFORE the call
      const r = await pp(
        "POST",
        `/v2/checkout/orders/${encodeURIComponent(o.id)}/capture`,
        {
          body: {},
          headers: {
            ...orderHeaders(state),
            "PayPal-Request-Id": o.captureRequestId,
            Prefer: "return=representation",
          },
        },
      );
      if (r.ok)
        info(
          "Capture call accepted; re-fetching the order from PayPal to verify...",
        );
      else {
        const e = safeErr(r);
        if (hasIssue(e, "ORDER_ALREADY_CAPTURED"))
          info("ORDER_ALREADY_CAPTURED: verifying via re-fetch...");
        else if (r.kind === "rejected") {
          bad(`Capture rejected: ${fmtErr(e)}`);
          return R("FAIL", "capture rejected");
        } else
          warn(
            `Capture response inconclusive (${fmtErr(e)}). NOT assuming failure: verifying actual state...`,
          );
      }
    } else if (g.json?.status !== "COMPLETED") {
      warn(
        `Order status is ${g.json?.status}; it must be APPROVED before capture.`,
      );
      return R("PAUSED", `order status ${g.json?.status}`);
    }
    const g2 = await getOrder(state, o.id);
    if (!g2.ok) return R("INCONCLUSIVE", "order re-read after capture");
    const v = verifyOrder(state, g2.json);
    if (v.pending) {
      warn("Capture is PENDING at PayPal. NOT paid. Re-run later to re-check.");
      return R("PENDING", "capture pending");
    }
    for (const [c, label] of v.checks) (c ? pass : bad)(label);
    const post = ["payee", "payer"]
      .map((k) => [k, identityOf(k, g2.json, state)])
      .map(([k, r]) => [k, r, recordIdentity(state, k, r)]);
    for (const [k, r, st] of post) reportIdentity(k, st, r.basis);
    if (post.some(([, , st]) => st === "MISMATCH")) {
      bad(
        `Order ${o.id} / capture ${v.cap?.id ?? "?"} exist at PayPal, but this run will NOT accept them.`,
      );
      info(
        "No disbursement or payout will be made. Fix the configuration and use --new-run.",
      );
      return R("FAIL", "identity mismatch after capture");
    }
    if (!v.allOk) return R("FAIL", "verification checks failed");
    const c = state.capture;
    c.id = v.cap.id;
    c.status = v.cap.status;
    c.hold = v.hold ?? null;
    c.paypalFee = v.brk?.paypal_fee?.value ?? null;
    c.sellerNet = v.brk?.net_amount?.value ?? null;
    c.platformFeeSeen = v.feeSeen ?? null;
    o.verified = true;
    saveState(state);
    if (state.mode === "delayed") {
      if (v.hold === "DELAYED")
        pass(
          "Hold verified: capture reports disbursement_mode DELAYED (seller NOT yet paid).",
        );
      else
        warn(
          "Hold UNVERIFIED: PayPal did not echo disbursement_mode. The release step will report the real result.",
        );
      if (c.sellerNet)
        info(
          `PayPal reports seller net ${c.sellerNet} ${CURRENCY} after fees (PayPal deducts fees from the seller's funds; compare with the intended ${PRICE}).`,
        );
    }
    pass(`Payment verified: capture ${c.id} COMPLETED ${TOTAL} ${CURRENCY}`);
    return R("PASS", `capture ${c.id}`);
  }
  pass(
    `Capture ${state.capture.id} already verified in an earlier run (no re-capture).`,
  );
  return R("PASS", `capture ${state.capture.id}`);
}

// ---------------------------------------------- E: simulated return window
async function stepWindow(state) {
  head("Step E - Simulated return window");
  if (!state.order.verified) return R("SKIPPED", "no verified capture");
  const w = state.window;
  const secs = Number.isFinite(FLAGS.window) ? FLAGS.window : 60;
  w.seconds = secs;
  w.startedAt ??= new Date().toISOString();
  saveState(state);
  for (;;) {
    const left = Math.ceil(
      (Date.parse(w.startedAt) + secs * 1000 - Date.now()) / 1000,
    );
    if (left <= 0) {
      pass(`Return window (${secs}s) elapsed with no dispute (simulated).`);
      return R("PASS", `${secs}s`);
    }
    if (!process.stdin.isTTY && !ANSWERS)
      return R("PAUSED", `return window has ${left}s left; re-run after that`);
    info(`Waiting ${left}s...`);
    await sleep(Math.min(left, 5) * 1000);
  }
}

// -------------------------------------------------- F: release / disbursement
function classifyReferenced(j) {
  const st = j?.processing_state?.status;
  if (st === "SUCCESS") return "SUCCESS"; // only the ITEM state proves the seller was paid
  if (st === "FAILED" || st === "PAYOUT_FAILED") return "FAILED";
  if (st === "PROCESSING") return "PENDING";
  return "UNKNOWN";
}
function classifyPayout(j) {
  const bs = j?.batch_header?.batch_status;
  const item = j?.items?.[0];
  const ts = item?.transaction_status;
  if (ts === "SUCCESS") return "SUCCESS";
  if (ts === "UNCLAIMED") return "UNCLAIMED";
  if (["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED"].includes(ts))
    return "FAILED";
  if (bs === "DENIED") return "DENIED";
  if (bs === "CANCELED") return "CANCELED";
  if (
    ["PENDING", "ONHOLD"].includes(ts) ||
    ["PENDING", "PROCESSING"].includes(bs) ||
    !item
  )
    return "PENDING";
  return "UNKNOWN";
}
const ambiguousGuard = (rel, what) => {
  if (rel.attempted && !FLAGS.confirmRetryRelease) {
    warn(
      `A previous ${what} call has no confirmed result. NOT retrying blindly.`,
    );
    info(
      "Check the sandbox accounts first (seller activity and platform activity for this capture). If nothing was sent, re-run with --confirm-retry-release.",
    );
    return R("PAUSED", `${what} ambiguous`);
  }
  return null;
};

async function stepRelease(state) {
  head(
    state.mode === "delayed"
      ? "Step F - Release held funds (Referenced Payouts) and verify"
      : "Step F - Standard Payout from platform balance (fallback) and verify",
  );
  const blocked = identityBlock(state, "Disbursement");
  if (blocked) return blocked;
  if (!state.order.verified) return R("SKIPPED", "no verified capture");
  return state.mode === "delayed"
    ? releaseDelayed(state)
    : releaseFallback(state);
}

async function releaseDelayed(state) {
  const rel = state.release;
  const capId = state.capture.id;
  rel.requestId ??= `brk-smoke2-rel-${state.runId}`;
  if (!rel.itemId) {
    const g = ambiguousGuard(rel, "referenced payout");
    if (g) return g;
    out(
      `\n  ABOUT TO MOVE SANDBOX MONEY: release the held funds of capture ${capId} to the seller via Referenced Payouts.`,
    );
    out(
      `  Intended seller amount: ${PRICE} ${CURRENCY}; platform fee ${FEE}. PayPal decides the final net.`,
    );
    if (!(await confirmStrict("  Release to the seller now?")))
      return R("PAUSED", "release not confirmed");
    rel.attempted = true;
    saveState(state); // persist intent BEFORE the call
    const r = await pp("POST", "/v1/payments/referenced-payouts-items", {
      headers: { ...partnerHeaders(), "PayPal-Request-Id": rel.requestId },
      body: { reference_id: capId, reference_type: "TRANSACTION_ID" },
    });
    if (r.ok) {
      rel.itemId = r.json?.item_id;
      if (!rel.itemId) {
        bad(
          "Release accepted but no item_id returned. NOT retrying (could duplicate).",
        );
        return R("INCONCLUSIVE", "no item id");
      }
      saveState(state);
      pass(
        "Release request accepted (acceptance is NOT success; checking the item state next).",
      );
    } else if (r.kind === "rejected") {
      rel.attempted = false;
      saveState(state);
      bad(`Release REJECTED: ${fmtErr(safeErr(r))}`);
      return R("FAIL", "release rejected");
    } else {
      warn(
        `Release call INCONCLUSIVE (${fmtErr(safeErr(r))}). A release may or may not exist.`,
      );
      return R("INCONCLUSIVE", "release call");
    }
  } else
    info("Resuming: will only READ the release item status (never re-create).");
  let cls = "PENDING";
  for (let i = 0; i < POLL_TRIES; i++) {
    const g = await pp(
      "GET",
      `/v1/payments/referenced-payouts-items/${encodeURIComponent(rel.itemId)}`,
      { headers: partnerHeaders() },
    );
    if (!g.ok) {
      warn(`Cannot read release item: ${fmtErr(safeErr(g))}`);
      cls = "INCONCLUSIVE";
      break;
    }
    cls = classifyReferenced(g.json);
    rel.state = g.json?.processing_state?.status ?? null;
    rel.destination = g.json?.payout_destination ?? null;
    saveState(state);
    info(`item processing_state=${rel.state ?? "?"}  -> ${cls}`);
    if (cls !== "PENDING") break;
    if (i < POLL_TRIES - 1) await sleep(pollMs());
  }
  return finishRelease(state, cls, "seller disbursement");
}

async function releaseFallback(state) {
  const rel = state.release;
  rel.senderBatchId ??= `brk-smoke2-${state.runId}`;
  rel.requestId ??= `brk-smoke2-po-${state.runId}`;
  rel.senderItemId ??= `brk-smoke2-item-${state.runId}`;
  if (!rel.batchId) {
    const g = ambiguousGuard(rel, "payout");
    if (g) return g;
    out(
      `\n  ABOUT TO MOVE SANDBOX MONEY: standard Payout of ${PRICE} ${CURRENCY} from the PLATFORM balance to the configured SELLER account.`,
    );
    out("  This is the FALLBACK path, not PayPal-native delayed disbursement.");
    if (!(await confirmStrict("  Send the payout now?")))
      return R("PAUSED", "payout not confirmed");
    rel.attempted = true;
    saveState(state);
    const r = await pp("POST", "/v1/payments/payouts", {
      headers: { "PayPal-Request-Id": rel.requestId },
      body: {
        sender_batch_header: {
          sender_batch_id: rel.senderBatchId,
          email_subject: "SANDBOX TEST payout (Brokerage AI Gate 1 v2)",
          email_message: "Sandbox test only.",
          recipient_type: "EMAIL",
        },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: CFG.emails.seller,
            amount: { currency: CURRENCY, value: PRICE },
            note: "SANDBOX TEST - seller payout",
            sender_item_id: rel.senderItemId,
            recipient_wallet: "PAYPAL",
          },
        ],
      },
    });
    if (r.ok) {
      rel.batchId = r.json?.batch_header?.payout_batch_id;
      if (!rel.batchId) {
        bad(
          "Payout accepted but no batch id returned. NOT retrying (could duplicate).",
        );
        return R("INCONCLUSIVE", "no batch id");
      }
      saveState(state);
      pass(
        `Payout batch accepted: ${rel.batchId} (acceptance is NOT success; checking the item next)`,
      );
    } else if (r.kind === "rejected") {
      const e = safeErr(r);
      rel.attempted = false;
      saveState(state);
      bad(`Payout REJECTED: ${fmtErr(e)}`);
      if (
        e.status === 401 ||
        e.status === 403 ||
        hasIssue(
          e,
          "AUTHORIZATION_ERROR",
          "NOT_AUTHORIZED",
          "PERMISSION_DENIED",
        )
      )
        info(
          "Payouts looks UNAVAILABLE for this app/account (note: PayPal lists India as receive-only, merchants there cannot send Payouts).",
        );
      return R("FAIL", "payout rejected");
    } else {
      warn(
        `Payout call INCONCLUSIVE (${fmtErr(safeErr(r))}). A payout may or may not exist.`,
      );
      return R("INCONCLUSIVE", "payout call");
    }
  } else
    info(
      `Resuming with payout batch ${rel.batchId}; will only READ its status.`,
    );
  let cls = "PENDING";
  for (let i = 0; i < POLL_TRIES; i++) {
    const g = await pp(
      "GET",
      `/v1/payments/payouts/${encodeURIComponent(rel.batchId)}`,
    );
    if (!g.ok) {
      warn(`Cannot read payout batch: ${fmtErr(safeErr(g))}`);
      cls = "INCONCLUSIVE";
      break;
    }
    cls = classifyPayout(g.json);
    rel.batchStatus = g.json?.batch_header?.batch_status ?? null;
    rel.itemStatus = g.json?.items?.[0]?.transaction_status ?? null;
    saveState(state);
    info(
      `batch_status=${rel.batchStatus ?? "?"}  item_status=${rel.itemStatus ?? "(none yet)"}  -> ${cls}`,
    );
    if (cls !== "PENDING") break;
    if (i < POLL_TRIES - 1) await sleep(pollMs());
  }
  return finishRelease(state, cls, "seller payout");
}

function finishRelease(state, cls, label) {
  const rel = state.release;
  if (cls === "SUCCESS") {
    rel.final = "SUCCESS";
    saveState(state);
    pass(`${label}: item state is SUCCESS.`);
    return R("SUCCESS", label);
  }
  if (["UNCLAIMED", "FAILED", "DENIED", "CANCELED"].includes(cls)) {
    rel.final = cls;
    saveState(state);
    bad(`${label} ${cls}. NOT a success.`);
    return R(cls, label);
  }
  warn(
    `${label} is ${cls}. Not reported as success. Re-run later to keep polling (nothing new is created).`,
  );
  return R(cls === "PENDING" ? "PENDING" : "INCONCLUSIVE", label);
}

// ------------------------------------------------------------------ summary
function exitCodeFor(results) {
  const vals = Object.values(results).map((r) => r.status);
  if (
    vals.some((s) =>
      ["FAIL", "FAILED", "DENIED", "CANCELED", "UNCLAIMED"].includes(s),
    )
  )
    return EXIT.FAIL;
  if (results.F?.status === "SUCCESS") return EXIT.OK;
  return EXIT.PAUSED;
}
function printSummary(state, results) {
  head(`Summary - v2 run ${state.runId} (SANDBOX, mode=${state.mode})`);
  const rows = [
    ["A OAuth", results.A],
    ["B Seller status (read-only)", results.B],
    ["C Order", results.C],
    ["D Identity + capture + verify", results.D],
    ["E Return window (simulated)", results.E],
    ["F Seller disbursement", results.F],
  ];
  for (const [label, r] of rows)
    out(
      `  ${label.padEnd(32)} ${(r?.status ?? "NOT RUN").padEnd(13)} ${scrub(r?.detail ?? "")}`,
    );
  out("");
  out(
    `  IDs  order=${state.order.id ?? "-"}  capture=${state.capture.id ?? "-"}  release_item=${state.release.itemId ?? "-"}  payout_batch=${state.release.batchId ?? "-"}`,
  );
  out(
    `  Amounts  price=${PRICE} fee=${FEE} buyer_total=${TOTAL} intended_seller=${PRICE} (${CURRENCY})`,
  );
  out(`  Identity checks  ${identityLine(state)}`);
  if (
    ["payee", "payer"].some(
      (k) => state.identity?.[k]?.status === "UNAVAILABLE",
    )
  )
    out(
      "  NOTE: UNAVAILABLE = PayPal did not return a comparable value; that identity was NOT independently verified.",
    );
  if (mismatches(state).length)
    out(
      "  FINDING: identity MISMATCH recorded. Workflow stopped until --new-run.",
    );
  if (state.mode === "fallback")
    out(
      "  NOTE: fallback mode is plain Orders + Payouts. It does NOT prove PayPal delayed disbursement.",
    );
  if (state.mode === "delayed" && state.diagnosis.delayedCapability)
    out(
      `  Delayed-disbursement capability: ${state.diagnosis.delayedCapability.status}${state.diagnosis.delayedCapability.code ? ` (${state.diagnosis.delayedCapability.code})` : ""}`,
    );
  if (state.capture.sellerNet)
    out(
      `  PayPal-reported seller net: ${state.capture.sellerNet} ${CURRENCY} (PayPal fee ${state.capture.paypalFee ?? "?"}); intended ${PRICE}`,
    );
  out(
    "  A Sandbox result is not proof of Live eligibility (India platform/partner status is unverified).",
  );
  out(
    `  State file: ${STATE_PATH.replace(/^.*[\\/]/, "")} (IDs only; gitignore it). v1 state is never touched.`,
  );
}

// --------------------------------------------------------------------- help
const HELP = `
Brokerage AI - PayPal SANDBOX smoke test v2 (no PayPal Invoicing)

  node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs [options]

  (no options)            Same as --diagnose: read-only checks. No orders, no money.
  --diagnose              OAuth + optional seller-status read. Prints what is and is not verifiable.
  --mode=delayed          Commerce Platform flow: DELAYED order + platform fee -> capture -> window -> Referenced Payout.
  --mode=fallback         Plain order -> capture -> window -> standard Payout (NOT delayed disbursement).
  --status                Show the saved v2 run (no config needed, no network).
  --window=SECONDS        Simulated return window (default 60).
  --confirm-retry-release Allow ONE retry of an ambiguous release/payout after you checked Sandbox activity.
  --new-run               Archive a finished (or money-free) v2 run to a timestamped file and start over.
  --yes                   Skip harmless prompts only. Capture and release always require typing "yes".
  --help

Exit codes: 0 success, 1 failure, 2 paused/pending/inconclusive, 3 config error.
v1 state (.paypal-smoke-state.json) is never read, modified or deleted by this script.
`;

// --------------------------------------------------------------------- main
function parseArgs(argv) {
  const f = {
    help: false,
    status: false,
    diagnose: false,
    yes: false,
    confirmRetryRelease: false,
    newRun: false,
    mode: null,
    window: NaN,
  };
  for (const a of argv) {
    const [k, v] = a.split("=");
    if (KNOWN_FLAGS.includes(a)) {
      if (a === "--help") f.help = true;
      else if (a === "--status") f.status = true;
      else if (a === "--diagnose") f.diagnose = true;
      else if (a === "--yes") f.yes = true;
      else if (a === "--confirm-retry-release") f.confirmRetryRelease = true;
      else if (a === "--new-run") f.newRun = true;
    } else if (KNOWN_VALUE_FLAGS.includes(k) && v !== undefined) {
      if (k === "--mode") {
        if (!["delayed", "fallback"].includes(v))
          configError('--mode must be "delayed" or "fallback".');
        f.mode = v;
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 3600)
          configError("--window must be an integer 0-3600.");
        f.window = n;
      }
    } else configError(`Unknown option: ${a}. Use --help.`);
  }
  return f;
}

async function main() {
  if (FLAGS.help) return out(HELP);
  let state = loadState();
  if (existsSync(V1_STATE_PATH))
    out(
      "(v1 state file present: preserved, not read or modified by this script)",
    );

  if (FLAGS.status) {
    if (!state) return out("No saved v2 run.");
    out(
      `v2 run ${state.runId} (${state.environment}, mode=${state.mode}), started ${state.createdAt}`,
    );
    for (const [k, v] of Object.entries(state.results)) out(`  ${k}: ${v}`);
    out(
      `  order=${state.order.id ?? "-"} capture=${state.capture.id ?? "-"} release_item=${state.release.itemId ?? "-"} payout_batch=${state.release.batchId ?? "-"} final=${state.release.final ?? "-"}`,
    );
    out(`  identity: ${identityLine(state)}`);
    if (state.diagnosis.delayedCapability)
      out(
        `  delayed capability: ${state.diagnosis.delayedCapability.status}${state.diagnosis.delayedCapability.code ? ` (${state.diagnosis.delayedCapability.code})` : ""}`,
      );
    return;
  }

  const mode = FLAGS.mode ?? state?.mode ?? null;
  if (state && FLAGS.mode && state.mode !== FLAGS.mode && !FLAGS.newRun)
    configError(
      `The saved v2 run is mode "${state.mode}". A run cannot switch modes. Use --new-run --mode=${FLAGS.mode} (the old run is archived, never deleted).`,
    );
  CFG = loadConfig(mode ?? "fallback");

  if (FLAGS.newRun && state) {
    if (state.order?.captureAttempted && !state.completedAt)
      configError(
        "The saved run captured money and is not complete. Finish it (or check Sandbox) before starting a new run.",
      );
    const arch = STATE_PATH.replace(/\.json$/, `.archive-${state.runId}.json`);
    assertV2Path(arch);
    renameSync(STATE_PATH, arch);
    out(
      `Archived previous v2 run ${state.runId} to ${arch.replace(/^.*[\\/]/, "")} (nothing deleted).`,
    );
    state = null;
  }

  out("============================================================");
  out(" SANDBOX SMOKE TEST v2 - no real money. Sandbox host only.");
  out("============================================================");
  out(
    `Accounts configured: platform=set buyer=set seller=set; seller_merchant_id=${CFG.ids.seller ? "set" : "not set"}; attribution_id=${CFG.bn ? "set" : "not set"} (values not shown)`,
  );

  if (!mode || FLAGS.diagnose) {
    head("DIAGNOSE (read-only: no orders, no money)");
    const a = await stepAuth();
    if (a.status !== "PASS") return EXIT.FAIL;
    const b = await stepSellerStatus(state);
    out(
      "\n  Not verifiable without creating an order (no money moves): whether PayPal accepts payee + disbursement_mode DELAYED + platform_fees for this app/seller.",
    );
    out(
      "  Not verifiable at all in Sandbox: Live eligibility (partner approval, India platform status).",
    );
    out(
      "  Next: node --env-file=.env.local scripts/paypal-sandbox-smoke-v2.mjs --mode=delayed",
    );
    return b.status === "FAIL" ? EXIT.FAIL : EXIT.OK;
  }

  if (state) {
    if (state.version !== 2 || state.environment !== "SANDBOX")
      configError("Saved state is not a v2 SANDBOX state. Refusing.");
    if (state.fingerprint !== CFG.fingerprint)
      configError(
        "The configured accounts/IDs changed since this run started. Restore the original values or use --new-run.",
      );
    if (state.completedAt) {
      out(
        `\nRun ${state.runId} is already COMPLETE (${state.completedAt}). Nothing will be repeated. Use --new-run for another.`,
      );
      return EXIT.OK;
    }
    out(`Resuming v2 run ${state.runId} (mode=${state.mode})`);
  } else {
    out(
      `\nNew ${mode} run. Test amounts: product ${PRICE} + 3% fee ${FEE} = buyer total ${TOTAL} ${CURRENCY}; intended seller ${PRICE}.`,
    );
    out(
      mode === "delayed"
        ? "Creating an order moves no money. Capture and release will each ask for explicit confirmation."
        : "FALLBACK: plain Orders + Payouts. Not PayPal delayed disbursement.",
    );
    if (!(await confirm("Create a new SANDBOX test run?")))
      throw new Exit(EXIT.PAUSED);
    state = newState(mode, CFG.fingerprint);
    saveState(state);
  }

  const results = {};
  const steps = [
    ["A", () => stepAuth()],
    [
      "B",
      () =>
        mode === "delayed"
          ? stepSellerStatus(state)
          : Promise.resolve(R("SKIPPED", "fallback mode")),
    ],
    ["C", () => stepOrder(state)],
    ["D", () => stepCapture(state)],
    ["E", () => stepWindow(state)],
    ["F", () => stepRelease(state)],
  ];
  for (const [key, fn] of steps) {
    results[key] = await fn();
    state.results[key] =
      results[key].status +
      (results[key].detail ? ` - ${scrub(results[key].detail)}` : "");
    saveState(state);
    const okish = ["PASS", "SUCCESS", "SKIPPED", "UNAVAILABLE"].includes(
      results[key].status,
    );
    if (!okish && !(key === "B")) break;
    if (key === "B" && results.B.status === "FAIL") break;
  }
  const code = exitCodeFor(results);
  if (
    ["SUCCESS", "UNCLAIMED", "FAILED", "DENIED", "CANCELED"].includes(
      results.F?.status,
    )
  ) {
    state.completedAt = new Date().toISOString();
    saveState(state);
  }
  printSummary(state, results);
  if (code === EXIT.PAUSED)
    out(
      "\nPAUSED / not yet conclusive. Re-run the same command to continue; nothing completed will be repeated.",
    );
  return code;
}

/** Entry used by the CLI and by tests. Returns an exit code; never calls process.exit itself. */
export async function run(argv) {
  cachedToken = null;
  tokenScope = "";
  CFG = null;
  SCRUB_VALUES = [];
  try {
    FLAGS = parseArgs(argv);
    return (await main()) ?? EXIT.OK;
  } catch (e) {
    if (e instanceof Exit) return e.code;
    out(`\nUNEXPECTED ERROR: ${scrub(e?.message ?? e)}`);
    return EXIT.FAIL;
  }
}
/** Test hooks. They only change a local file path and scripted answers; the API host stays a constant. */
export const __test = {
  setStatePath: (p) => {
    assertV2Path(p);
    STATE_PATH = p;
  },
  setAnswers: (a) => {
    ANSWERS = a;
  },
  BASE_URL,
  V1_STATE_PATH,
  cmp,
  classifyReferenced,
  classifyPayout,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
