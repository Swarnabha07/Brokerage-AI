import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buyerOfferCents, sellerCounterCents, parseOfferCents, redactPrivateAmounts } from "../../lib/negotiation/policy.mjs";
import { parsePriceToCents, valueFromCents } from "../../lib/payments/money.mjs";

test("money follows the repository USD-dollar to integer-cent contract", () => {
  assert.equal(parsePriceToCents("12.34"), 1234);
  assert.equal(parsePriceToCents("12.345"), null);
  assert.equal(valueFromCents(1234), "12.34");
  assert.equal(Math.round(12.34 * 100), 1234); // listings.floor_price/price are USD numeric values
});

test("server price policy keeps buyer offers under max and seller counters above floor", () => {
  assert.equal(buyerOfferCents(10000, 12000), 11000);
  assert.equal(buyerOfferCents(12000, 10000), null, "never offers at or above the buyer's private maximum");
  assert.equal(sellerCounterCents(7000, 10000, 8000), 9000);
  assert.equal(sellerCounterCents(9000, 10000, 8000), 9000);
  for (let ask = 9000; ask <= 20000; ask += 137) {
    const bid = buyerOfferCents(ask, 20000);
    assert.ok(bid >= ask && bid < 20000);
  }
});

test("offer parser accepts explicit dollar offers but rejects negatives and malformed precision", () => {
  assert.equal(parseOfferCents("I can offer $1,234.50"), 123450);
  assert.equal(parseOfferCents("price: 5.2"), 520);
  assert.equal(parseOfferCents("I have 2 kids"), null);
  assert.equal(parseOfferCents("offer -$5"), null);
  assert.equal(parseOfferCents("$5.155"), null);
  assert.equal(parseOfferCents("NaN"), null);
});

test("private buyer limits and seller floors are redacted from model transcript", () => {
  assert.equal(redactPrivateAmounts("My max is $120.00 and the floor is 40", [12000, 4000]), "My max is [private amount] and the floor is [private amount]");
});

test("database migration contains defense-in-depth approval, privacy and service-role gates", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/009_ai_negotiation.sql", import.meta.url), "utf8");
  assert.match(sql, /buyer_budget is null/);
  assert.match(sql, /add table public\.deals \(id\)/);
  assert.match(sql, /brk_neg_approval_required/);
  assert.match(sql, /approved_terms_hash is distinct from a\.terms_hash/);
  assert.match(sql, /buyer_accepted_hash is distinct from a\.terms_hash/);
  assert.match(sql, /seller_accepted_hash is distinct from a\.terms_hash/);
  assert.match(sql, /from public,anon,authenticated/);
});

test("browser DTO and Realtime subscription do not select private budget data", () => {
  const route = readFileSync(new URL("../../app/api/deals/[id]/route.ts", import.meta.url), "utf8");
  const create = readFileSync(new URL("../../app/api/deals/route.ts", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../../app/api/deals/[id]/messages/route.ts", import.meta.url), "utf8");
  const data = readFileSync(new URL("../../lib/api/deals.js", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../components/features/deal/DealWorkspace.js", import.meta.url), "utf8");
  assert.doesNotMatch(route, /buyer_budget/);
  assert.match(create, /buyer_budget:\s*null/);
  assert.doesNotMatch(create, /buyer_budget:\s*parsed/);
  assert.match(messages, /assertSameOrigin\(request\)/);
  assert.doesNotMatch(data, /buyer_budget/);
  assert.match(workspace, /select:\s*\["id"\]/);
});
