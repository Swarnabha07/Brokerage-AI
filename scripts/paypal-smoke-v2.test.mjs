// Offline mock tests for paypal-sandbox-smoke-v2.mjs. No network, no credentials, no real PayPal.
//   node scripts/paypal-smoke-v2.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, __test } from './paypal-sandbox-smoke-v2.mjs';

const FAKE = {
  PAYPAL_CLIENT_ID: 'FakeClientIdAAAA1111', PAYPAL_SECRET: 'FakeSecretZZZZ9999', PAYPAL_ENVIRONMENT: 'SANDBOX',
  PAYPAL_PLATFORM_BUSINESS_EMAIL: 'platform-fake@example.test', PAYPAL_SMOKE_BUYER_EMAIL: 'buyer-fake@example.test',
  PAYPAL_SMOKE_SELLER_EMAIL: 'seller-fake@example.test', PAYPAL_SMOKE_SELLER_MERCHANT_ID: 'SELLERMID12345',
  PAYPAL_SMOKE_BUYER_PAYER_ID: 'BUYERPID12345', PAYPAL_PARTNER_ATTRIBUTION_ID: 'BNFAKE_SP', PAYPAL_SMOKE_POLL_MS: '1',
};
const SECRETS = [FAKE.PAYPAL_SECRET, FAKE.PAYPAL_CLIENT_ID, 'platform-fake@', 'buyer-fake@', 'seller-fake@', FAKE.PAYPAL_SMOKE_SELLER_MERCHANT_ID, FAKE.PAYPAL_SMOKE_BUYER_PAYER_ID];
const dir = mkdtempSync(path.join(tmpdir(), 'v2test-'));
let n = 0; const results = [];

function newMock(opts = {}) {
  const m = { calls: [], order: null, captured: false, relPosts: 0, payoutPosts: 0, capPosts: 0, orderPosts: 0, getsAfterApproved: 0, ...opts };
  const ordObj = () => {
    const mode = m.order.delayed;
    const o = {
      id: 'ORDER1', status: m.captured ? 'COMPLETED' : (m.approved ? 'APPROVED' : 'CREATED'), intent: 'CAPTURE',
      purchase_units: [{ custom_id: m.order.customId, amount: { currency_code: 'USD', value: '5.15' },
        payee: m.payee ?? (mode ? { email_address: FAKE.PAYPAL_SMOKE_SELLER_EMAIL, merchant_id: FAKE.PAYPAL_SMOKE_SELLER_MERCHANT_ID } : { email_address: FAKE.PAYPAL_PLATFORM_BUSINESS_EMAIL }),
        ...(mode && m.preHold !== null ? { payment_instruction: { disbursement_mode: m.preHold ?? 'DELAYED' } } : {}) }],
      links: [{ rel: 'payer-action', href: 'https://sandbox.paypal.test/approve?token=ORDER1' }],
    };
    if (m.approved || m.captured) { o.payer = m.payer ?? { payer_id: FAKE.PAYPAL_SMOKE_BUYER_PAYER_ID, email_address: FAKE.PAYPAL_SMOKE_BUYER_EMAIL }; }
    if (m.captured) o.purchase_units[0].payments = { captures: [{ id: 'CAP1', status: m.capStatus ?? 'COMPLETED', amount: { currency_code: 'USD', value: '5.15' },
      ...(mode && m.capHold !== null ? { disbursement_mode: m.capHold ?? 'DELAYED' } : {}),
      seller_receivable_breakdown: { platform_fees: mode ? [{ amount: { value: '0.15' } }] : undefined, paypal_fee: { value: '0.45' }, net_amount: { value: '4.55' } } }] };
    return o;
  };
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith(__test.BASE_URL + '/'), `non-sandbox URL used: ${url}`);
    const p = String(url).slice(__test.BASE_URL.length); const method = init.method ?? 'GET';
    m.calls.push(`${method} ${p}`);
    const J = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
    if (p === '/v1/oauth2/token') return J(200, { access_token: 'TOKEN-MOCK-123', scope: 'https://uri.paypal.com/services/payments/payment/authcapture partner' });
    if (p === '/v2/checkout/orders' && method === 'POST') {
      m.orderPosts++;
      if (m.createStatus && m.createStatus >= 400 && m.createStatus < 500) return J(m.createStatus, { name: 'NOT_AUTHORIZED', message: 'nope seller-fake@example.test', debug_id: 'dbg1' });
      const body = JSON.parse(init.body);
      m.order = { customId: body.purchase_units[0].custom_id, delayed: body.purchase_units[0].payment_instruction?.disbursement_mode === 'DELAYED', body, headers: init.headers };
      return J(201, ordObj());
    }
    if (p === '/v2/checkout/orders/ORDER1' && method === 'GET') { m.gets = (m.gets ?? 0) + 1; if (m.gets >= 2 || m.autoApprove) m.approved = true; return J(200, ordObj()); }
    if (p === '/v2/checkout/orders/ORDER1/capture') {
      m.capPosts++; m.captured = true;
      if (m.captureFlaky) { m.captureFlaky = false; return J(500, { name: 'INTERNAL' }); }
      return J(201, ordObj());
    }
    if (p === '/v1/payments/referenced-payouts-items' && method === 'POST') {
      m.relPosts++;
      if (m.relStatus) return J(m.relStatus, { name: 'INTERNAL_SERVER_ERROR' });
      return J(202, { item_id: 'ITEM1=' });
    }
    if (p.startsWith('/v1/payments/referenced-payouts-items/')) return J(200, { item_id: 'ITEM1=', processing_state: { status: m.itemState ?? 'SUCCESS' }, payout_destination: 'PAYEE' });
    if (p === '/v1/payments/payouts' && method === 'POST') { m.payoutPosts++; return J(201, { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } }); }
    if (p === '/v1/payments/payouts/B1') return J(200, { batch_header: { batch_status: 'SUCCESS' }, items: [{ transaction_status: m.payoutItem ?? 'SUCCESS' }] });
    return J(404, { name: 'NOT_FOUND' });
  };
  return m;
}
async function exec(argv, answers) {
  Object.assign(process.env, FAKE); __test.setAnswers(answers);
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
  let code; try { code = await run(argv); } finally { console.log = orig; }
  const text = lines.join('\n');
  for (const s of SECRETS) assert.ok(!text.includes(s), `LEAK in output: ${s}`);
  return { code, text };
}
const sp = () => path.join(dir, `s${++n}.v2.json`);
const stateOf = (p) => JSON.parse(readFileSync(p, 'utf8'));
function noLeakInFile(p) { const t = readFileSync(p, 'utf8'); for (const s of SECRETS) assert.ok(!t.includes(s), `LEAK in state: ${s}`); assert.ok(!/TOKEN-MOCK/.test(t)); }
async function t(name, fn) { try { await fn(); results.push([true, name]); } catch (e) { results.push([false, `${name}\n      ${e.message}`]); } }
const HAPPY = ['y', '', 'yes', 'yes'];

const v1sentinel = __test.V1_STATE_PATH; const v1existed = existsSync(v1sentinel);
if (!v1existed) writeFileSync(v1sentinel, '{"sentinel":"v1"}'); const v1before = readFileSync(v1sentinel, 'utf8');

await t('delayed happy path: verified capture, release SUCCESS, one POST each, resume repeats nothing', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock();
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]);
  assert.equal(r.code, 0, r.text);
  assert.equal(m.orderPosts, 1); assert.equal(m.capPosts, 1); assert.equal(m.relPosts, 1);
  const b = m.order.body.purchase_units[0];
  assert.equal(b.amount.value, '5.15'); assert.equal(b.payment_instruction.disbursement_mode, 'DELAYED');
  assert.equal(b.payment_instruction.platform_fees[0].amount.value, '0.15'); assert.equal(b.payee.merchant_id, FAKE.PAYPAL_SMOKE_SELLER_MERCHANT_ID);
  assert.ok(m.order.headers['PayPal-Auth-Assertion'].endsWith('.')); assert.equal(m.order.headers['PayPal-Partner-Attribution-Id'], 'BNFAKE_SP');
  const st = stateOf(s); assert.equal(st.release.final, 'SUCCESS'); assert.ok(st.completedAt); noLeakInFile(s);
  assert.equal(st.identity.payee.status, 'MATCH'); assert.deepEqual(st.identity.payee.basis.sort(), ['email', 'id']);
  const r2 = await exec(['--mode=delayed', '--window=0'], []); assert.equal(r2.code, 0); assert.equal(m.orderPosts, 1); assert.equal(m.capPosts, 1); assert.equal(m.relPosts, 1);
});
await t('only sandbox host used on every call (asserted inside mock fetch)', async () => { assert.equal(__test.BASE_URL, 'https://api-m.sandbox.paypal.com'); });
await t('delayed unavailable (HTTP 403 at order create): FAIL, no capture, diagnosis saved, fallback hint', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ createStatus: 403 });
  const r = await exec(['--mode=delayed', '--window=0'], ['y']);
  assert.equal(r.code, 1); assert.equal(m.capPosts, 0); assert.equal(m.relPosts, 0);
  assert.equal(stateOf(s).diagnosis.delayedCapability.status, 'UNAVAILABLE'); assert.match(r.text, /--mode=fallback/); noLeakInFile(s);
});
await t('delayed unavailable (HTTP 401): classified as partner-auth problem', async () => {
  const s = sp(); __test.setStatePath(s); newMock({ createStatus: 401 });
  const r = await exec(['--mode=delayed'], ['y']); assert.equal(r.code, 1); assert.equal(stateOf(s).diagnosis.delayedCapability.code, 'PARTNER_AUTH');
});
await t('payee identity MISMATCH before capture: no capture; resume stays blocked; sticky', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ payee: { email_address: 'attacker@example.test', merchant_id: 'OTHERMID99999' } });
  const r = await exec(['--mode=delayed', '--window=0'], ['y', '', 'yes', 'yes']); assert.equal(r.code, 1); assert.equal(m.capPosts, 0);
  m.payee = undefined; // even if PayPal later "looks right", sticky mismatch blocks
  const r2 = await exec(['--mode=delayed', '--window=0'], ['yes']); assert.equal(r2.code, 1); assert.equal(m.capPosts, 0); assert.equal(m.relPosts, 0); noLeakInFile(s);
});
await t('payer id MISMATCH (configured buyer id differs): blocked before capture', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ payer: { payer_id: 'WRONGPAYER999', email_address: FAKE.PAYPAL_SMOKE_BUYER_EMAIL } });
  const r = await exec(['--mode=delayed', '--window=0'], ['y', '', 'yes']); assert.equal(r.code, 1); assert.equal(m.capPosts, 0);
});
await t('identity UNAVAILABLE is reported as unverified, never as a match', async () => {
  const s = sp(); __test.setStatePath(s); newMock({ payee: {}, payer: {} });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]);
  const st = stateOf(s); assert.equal(st.identity.payee.status, 'UNAVAILABLE'); assert.equal(st.identity.payer.status, 'UNAVAILABLE');
  assert.match(r.text, /NOT independently verified/); assert.doesNotMatch(r.text, /matches the configured account/);
});
await t('disbursement_mode INSTANT after capture: FAIL, no release', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ capHold: 'INSTANT' });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 1); assert.equal(m.relPosts, 0);
});
await t('order not DELAYED before capture: refuses to capture', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ preHold: 'INSTANT' });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 1); assert.equal(m.capPosts, 0);
});
await t('capture response 500 (ambiguous): verifies by re-fetch; no second capture', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ captureFlaky: true });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 0, r.text); assert.equal(m.capPosts, 1);
});
await t('capture PENDING is not paid; no release', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ capStatus: 'PENDING' });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 2); assert.equal(m.relPosts, 0);
});
await t('release call 500 is ambiguous: paused, no blind retry, retry only with flag', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ relStatus: 500 });
  let r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 2); assert.equal(m.relPosts, 1);
  r = await exec(['--mode=delayed', '--window=0'], ['yes']); assert.equal(r.code, 2); assert.equal(m.relPosts, 1, 'must not re-POST without the flag');
  m.relStatus = 0; r = await exec(['--mode=delayed', '--window=0', '--confirm-retry-release'], ['yes']); assert.equal(r.code, 0, r.text); assert.equal(m.relPosts, 2);
});
await t('release item PROCESSING: not success; rerun only reads status', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock({ itemState: 'PROCESSING' });
  let r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 2); assert.equal(m.relPosts, 1);
  m.itemState = 'SUCCESS'; r = await exec(['--mode=delayed', '--window=0'], []); assert.equal(r.code, 0, r.text); assert.equal(m.relPosts, 1);
});
await t('release item FAILED is a failure, never success', async () => {
  const s = sp(); __test.setStatePath(s); newMock({ itemState: 'PAYOUT_FAILED' });
  const r = await exec(['--mode=delayed', '--window=0'], [...HAPPY]); assert.equal(r.code, 1); assert.notEqual(stateOf(s).release.final, 'SUCCESS');
});
await t('confirmation words are required: --yes does not bypass capture', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock();
  const r = await exec(['--mode=delayed', '--yes'], ['', 'no']); assert.equal(m.capPosts, 0); assert.equal(r.code, 2);
});
await t('fallback happy path: platform payee, standard payout item SUCCESS, labelled not-delayed', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock();
  const r = await exec(['--mode=fallback', '--window=0'], [...HAPPY]); assert.equal(r.code, 0, r.text);
  assert.equal(m.order.body.purchase_units[0].payment_instruction, undefined); assert.equal(m.order.body.purchase_units[0].payee, undefined);
  assert.equal(m.payoutPosts, 1); assert.match(r.text, /does NOT prove PayPal delayed disbursement/); noLeakInFile(s);
});
await t('fallback payout item UNCLAIMED is not success', async () => {
  const s = sp(); __test.setStatePath(s); newMock({ payoutItem: 'UNCLAIMED' });
  const r = await exec(['--mode=fallback', '--window=0'], [...HAPPY]); assert.equal(r.code, 1);
});
await t('mode lock and --new-run archive (nothing deleted)', async () => {
  const s = sp(); __test.setStatePath(s); newMock({ createStatus: 403 });
  await exec(['--mode=delayed'], ['y']);
  let r = await exec(['--mode=fallback'], ['y']); assert.equal(r.code, 3);
  r = await exec(['--new-run', '--mode=fallback', '--window=0'], ['y', '', 'yes', 'yes']);
  assert.ok(readdirSync(dir).some((f) => f.includes('archive-')), 'archive file missing');
});
await t('diagnose is read-only (no order/capture/payout calls)', async () => {
  const s = sp(); __test.setStatePath(s); const m = newMock();
  const r = await exec([], []); assert.equal(r.code, 0); assert.ok(m.calls.every((c) => c.includes('oauth2/token')), m.calls.join(','));
});
await t('config guards: non-SANDBOX env, unknown flag, v1 path refused', async () => {
  newMock(); process.env.PAYPAL_ENVIRONMENT = 'LIVE';
  Object.assign(process.env, { ...FAKE, PAYPAL_ENVIRONMENT: 'LIVE' }); __test.setAnswers([]);
  const o = console.log; console.log = () => {}; let c1; try { c1 = await run(['--diagnose']); } finally { console.log = o; }
  assert.equal(c1, 3); Object.assign(process.env, FAKE);
  const r = await exec(['--fresh'], []); assert.equal(r.code, 3);
  assert.throws(() => __test.setStatePath(__test.V1_STATE_PATH));
});
await t('v1 state file untouched', async () => { assert.ok(existsSync(v1sentinel)); assert.equal(readFileSync(v1sentinel, 'utf8'), v1before); });

if (!v1existed) rmSync(v1sentinel);
rmSync(dir, { recursive: true, force: true });
let failed = 0;
for (const [ok, name] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
