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
  released: { label: "Released", step: "Complete" },
  disputed: { label: "Disputed", step: "Disputed" },
  cancelled: { label: "Cancelled", step: "Cancelled" },
  refunded: { label: "Refunded", step: "Refunded" },
};

/** Statuses outside the happy-path stepper (shown with their own banners). */
export const SIDE_STATUSES = ["disputed", "cancelled", "refunded"];
export const PLANNED_STATUSES = [];
