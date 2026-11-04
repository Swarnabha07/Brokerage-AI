const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(amount) {
  return currency.format(amount);
}

// Fixed locale and timezone keep output identical on server and client.
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Formats an ISO date string such as "2026-10-24" as "Oct 24". */
export function formatDate(iso) {
  return iso ? shortDate.format(new Date(iso)) : "—";
}
