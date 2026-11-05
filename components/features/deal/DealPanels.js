"use client";

import {
  CheckCircle2,
  Clock,
  Info,
  PackageCheck,
  Send,
  Truck,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatBubble } from "@/components/features/deal/ChatBubble";
import { CountdownRing } from "@/components/features/deal/CountdownRing";
import { formatCurrency } from "@/lib/format";
import { FEE_RATE_LABEL } from "@/lib/fees";

function PanelTitle({ children, simulated = true }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-lg font-semibold">{children}</h2>
      {simulated ? (
        <Badge variant="warning">Simulated</Badge>
      ) : (
        <Badge variant="success">Live Deal</Badge>
      )}
    </div>
  );
}

function Waiting({ children }) {
  return (
    <p
      role="status"
      className="flex gap-2 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Row({ label, value, strong }) {
  return (
    <div
      className={
        strong
          ? "flex justify-between border-t border-border pt-3 font-medium"
          : "flex justify-between"
      }
    >
      <dt className={strong ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd className="font-tabular">{value}</dd>
    </div>
  );
}

function Result({ icon: Icon, title, children }) {
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0 text-success"
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function StagePanel({
  status,
  role,
  deal,
  accepted,
  onAccept,
  onAdvance,
  onWindowEnd,
  returnWindowSeconds,
  isLive = false,
  isPending = false,
}) {
  const { amounts } = deal;

  if (status === "negotiating") {
    return (
      <>
        <PanelTitle simulated={!isLive}>Negotiation</PanelTitle>
        <p className="mb-4 text-xs text-muted-foreground">
          {isLive
            ? "Negotiation transcript recorded on Supabase."
            : "Sample transcript."}
        </p>
        <ul className="mb-6 space-y-4" aria-label="Negotiation transcript">
          {deal.messages.map((m) => (
            <ChatBubble key={m.id} sender={m.sender} text={m.text} />
          ))}
        </ul>
        {role === "buyer" || role === "seller" ? (
          <Button onClick={() => onAdvance("agreed")} disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Updating...
              </span>
            ) : (
              "Accept terms & conclude negotiation"
            )}
          </Button>
        ) : (
          <Waiting>
            Your role could not be verified for this deal. Refresh the page
            before continuing.
          </Waiting>
        )}
      </>
    );
  }

  if (status === "agreed") {
    return (
      <>
        <PanelTitle simulated={!isLive}>Agreed terms</PanelTitle>
        <dl className="mb-6 space-y-3 rounded-xl border border-border p-4 text-sm">
          <Row label="Item" value={deal.title} />
          <Row label="Agreed price" value={formatCurrency(amounts.price)} />
          <Row label="Delivery" value={deal.terms.delivery} />
          <Row label="Return policy" value={deal.terms.returnPolicy} />
        </dl>
        {role === "seller" ? (
          <Button onClick={() => onAdvance("invoiced")} disabled={isPending}>
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Creating invoice...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Send className="h-4 w-4" aria-hidden="true" /> Approve terms
                &amp; create invoice
              </span>
            )}
          </Button>
        ) : (
          <Waiting>Waiting for the seller to approve these terms.</Waiting>
        )}
      </>
    );
  }

  if (status === "invoiced") {
    return (
      <>
        <PanelTitle simulated={!isLive}>Invoice &amp; Checkout</PanelTitle>
        <dl className="mb-6 space-y-3 rounded-xl border border-border p-4 text-sm">
          <Row label="Item price" value={formatCurrency(amounts.price)} />
          <Row
            label={`Platform fee (${FEE_RATE_LABEL}, buyer-paid)`}
            value={`+${formatCurrency(amounts.fee)}`}
          />
          <Row
            label="Total due (Buyer)"
            value={formatCurrency(amounts.buyerTotal)}
            strong
          />
          <Row
            label="Seller receives (full item price)"
            value={formatCurrency(amounts.sellerAmount)}
          />
        </dl>
        <p className="mb-5 flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Invoice generated. Demo fee model; PayPal Sandbox payment capture is
          not connected yet.
        </p>
        {role === "buyer" ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => onAccept(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7c3aed]"
                disabled={isPending}
              />
              <span>I reviewed the invoice terms.</span>
            </label>
            <Button
              disabled={!accepted || isPending}
              onClick={() => onAdvance("paid")}
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing
                  payment...
                </span>
              ) : (
                "Pay invoice (PayPal Sandbox — coming soon)"
              )}
            </Button>
          </div>
        ) : (
          <Waiting>Waiting for the buyer to pay.</Waiting>
        )}
      </>
    );
  }

  if (status === "paid") {
    return (
      <>
        <PanelTitle simulated={!isLive}>Payment</PanelTitle>
        <Result icon={CheckCircle2} title="Payment recorded">
          Payment recorded. The deal is released to the seller only after
          delivery confirmation and the return window ends (server-controlled,
          app-managed workflow).
        </Result>
        {role === "seller" ? (
          <Button
            onClick={() =>
              onAdvance("shipped", {
                tracking_number: `TRK-${Date.now().toString(36).toUpperCase()}`,
              })
            }
            disabled={isPending}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Updating
                shipment...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Truck className="h-4 w-4" aria-hidden="true" /> Mark as shipped
              </span>
            )}
          </Button>
        ) : (
          <Waiting>Waiting for the seller to ship.</Waiting>
        )}
      </>
    );
  }

  if (status === "shipped") {
    return (
      <>
        <PanelTitle simulated={!isLive}>Delivery &amp; Tracking</PanelTitle>
        <Result icon={Truck} title="Order Shipped">
          {deal.tracking_number
            ? `Tracking number: ${deal.tracking_number}. Awaiting buyer receipt confirmation.`
            : "Item is in transit."}
        </Result>
        {role === "buyer" ? (
          <Button
            onClick={() => onAdvance("return_window")}
            disabled={isPending}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Confirming...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4" aria-hidden="true" /> Confirm
                delivery &amp; start return window
              </span>
            )}
          </Button>
        ) : (
          <Waiting>Waiting for the buyer to confirm receipt.</Waiting>
        )}
      </>
    );
  }

  if (status === "return_window") {
    const startedAt =
      deal?.terms?.return_window_started_at ||
      deal?.terms_json?.return_window_started_at ||
      null;

    return (
      <>
        <PanelTitle simulated={!isLive}>Inspection Window</PanelTitle>
        <CountdownRing
          key={startedAt || "no-start"}
          totalSeconds={returnWindowSeconds || 60}
          startedAt={startedAt}
          onComplete={onWindowEnd}
        />
        <p className="mx-auto mt-5 max-w-md text-center text-sm text-muted-foreground">
          Inspection window active ({returnWindowSeconds || 60}s demo timer,
          clearly labeled as simulating a real return period). When it ends
          without dispute, the deal is released by the server and a payout
          record is created (no PayPal payout yet).
        </p>
      </>
    );
  }

  return (
    <>
      <PanelTitle simulated={!isLive}>Settlement &amp; Payout</PanelTitle>
      <Result icon={PackageCheck} title="Deal Completed">
        Deal released. Seller payout recorded:{" "}
        {formatCurrency(amounts.sellerAmount)}
        (platform fee from buyer: {formatCurrency(amounts.fee)}). No PayPal
        payout has been made yet.
      </Result>
    </>
  );
}
