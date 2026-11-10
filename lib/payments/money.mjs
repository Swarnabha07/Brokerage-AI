// Integer-cent money helpers shared by server code and tests. No floats cross a money boundary.

/** "12.34" | 12.34 -> 1234. Rejects anything with more than 2 decimals, negatives, NaN, exponents. */
export function parsePriceToCents(input) {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents <= 2_147_483_647 ? cents : null;
}

/** PayPal value string ("5.15") -> cents, strictly. */
export const centsFromValue = (v) => (typeof v === "string" ? parsePriceToCents(v) : null);

export const valueFromCents = (c) => {
  if (!Number.isInteger(c) || c < 0) throw new Error("invalid cents");
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
};

/** Platform fee in cents: rate x price, half-up, same rounding as lib/fees.js. */
export const feeCentsFor = (priceCents, rate) => {
  if (rate === 0.03) return Math.floor((priceCents * 3 + 50) / 100);
  return Math.round(priceCents * rate);
};
