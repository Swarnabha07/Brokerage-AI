/**
 * Documented lifecycle (documentation.md):
 * negotiating → agreed → invoiced → paid → shipped → return_window → released
 */
export const DEAL_STATUS_ORDER = [
  "negotiating",
  "agreed",
  "invoiced",
  "paid",
  "shipped",
  "return_window",
  "released",
];

export const DEAL_STATUS_META = {
  negotiating: { label: "Negotiating", step: "Negotiate" },
  agreed: { label: "Awaiting seller approval", step: "Terms" },
  invoiced: { label: "Awaiting payment", step: "Invoice" },
  paid: { label: "Paid", step: "Payment" },
  shipped: { label: "Shipped", step: "Shipping" },
  return_window: { label: "Return window", step: "Return window" },
  released: { label: "Complete", step: "Complete" },
};

/**
 * `disputed` appears in documentation.md "where implemented". It is PLANNED
 * and intentionally not part of DEAL_STATUS_ORDER or any UI flow yet.
 */
export const PLANNED_STATUSES = ["disputed"];
