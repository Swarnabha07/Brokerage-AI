"use client";

import {
  CheckCircle2,
  Clock,
  Info,
  PackageCheck,
  Send,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatBubble } from "@/components/features/deal/ChatBubble";
import { CountdownRing } from "@/components/features/deal/CountdownRing";
import { formatCurrency } from "@/lib/format";
import { FEE_RATE_LABEL } from "@/lib/fees";

function PanelTitle({ children, simulated }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-lg font-semibold">{children}</h2>
      {simulated && <Badge variant="warning">Simulated</Badge>}
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
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="font-tabular">{value}</dd>
    </div>
  );
}

function Result({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
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
  returnWindowSeconds,
}) {
  const { amounts } = deal;

  if (status === "negotiating") {
    return (
      <>
        <PanelTitle>Negotiation</PanelTitle>
        <p className="mb-4 text-xs text-muted-foreground">
          Sample transcript — no AI model is connected yet.
        </p>
        <ul
          className="mb-6 space-y-4"
          aria-label="Sample negotiation transcript"
        >
          {deal.messages.map((m) => (
            <ChatBubble key={m.id} sender={m.sender} text={m.text} />
          ))}
        </ul>
        <Button onClick={() => onAdvance("agreed")}>
          Simulate: parties reach agreement
        </Button>
      </>
    );
  }

  if (status === "agreed") {
    return (
      <>
        <PanelTitle simulated>Agreed terms</PanelTitle>
        <dl className="mb-6 space-y-3 rounded-xl border border-border p-4 text-sm">
          <Row label="Item" value={deal.title} />
          <Row label="Agreed price" value={formatCurrency(amounts.price)} />
          <Row label="Delivery" value={deal.terms.delivery} />
          <Row label="Return policy" value={deal.terms.returnPolicy} />
        </dl>
        {role === "seller" ? (
          <Button onClick={() => onAdvance("invoiced")}>
            <Send className="h-4 w-4" aria-hidden="true" /> Approve terms &amp;
            create invoice (simulated)
          </Button>
        ) : (
          <Waiting>
            Waiting for the seller to approve these terms. Switch to the seller
            view in the demo controls to continue.
          </Waiting>
        )}
      </>
    );
  }

  if (status === "invoiced") {
    return (
      <>
        <PanelTitle simulated>Invoice</PanelTitle>
        <dl className="mb-6 space-y-3 rounded-xl border border-border p-4 text-sm">
          <Row label="Item price" value={formatCurrency(amounts.price)} />
          <Row
            label={`Platform fee, demo assumption (${FEE_RATE_LABEL})`}
            value={formatCurrency(amounts.fee)}
          />
          <Row
            label="Total due"
            value={formatCurrency(amounts.buyerTotal)}
            strong
          />
        </dl>
        <p className="mb-5 flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This is a mock invoice. No PayPal invoice exists, and the fee is a
          provisional assumption.
        </p>
        {role === "buyer" ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => onAccept(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7c3aed]"
              />
              <span>
                I reviewed the invoice and understand that no real payment is
                processed in this demo.
              </span>
            </label>
            <Button disabled={!accepted} onClick={() => onAdvance("paid")}>
              Simulate payment (demo)
            </Button>
          </div>
        ) : (
          <Waiting>
            Waiting for the buyer to pay. Switch to the buyer view in the demo
            controls to continue.
          </Waiting>
        )}
      </>
    );
  }

  if (status === "paid") {
    return (
      <>
        <PanelTitle simulated>Payment</PanelTitle>
        <Result icon={CheckCircle2} title="Payment recorded (simulated)">
          Nothing was charged. In a real deal the backend would verify the
          PayPal capture before this state could appear.
        </Result>
        {role === "seller" ? (
          <Button onClick={() => onAdvance("shipped")}>
            <Truck className="h-4 w-4" aria-hidden="true" /> Simulate: mark as
            shipped
          </Button>
        ) : (
          <Waiting>
            Waiting for the seller to ship. Switch to the seller view to
            continue.
          </Waiting>
        )}
      </>
    );
  }

  if (status === "shipped") {
    return (
      <>
        <PanelTitle simulated>Delivery</PanelTitle>
        <Result icon={Truck} title="Marked as shipped (simulated)">
          No shipment exists and no tracking number is generated in this demo.
        </Result>
        {role === "buyer" ? (
          <Button onClick={() => onAdvance("return_window")}>
            <PackageCheck className="h-4 w-4" aria-hidden="true" /> Simulate:
            confirm receipt
          </Button>
        ) : (
          <Waiting>
            Waiting for the buyer to confirm receipt. Switch to the buyer view
            to continue.
          </Waiting>
        )}
      </>
    );
  }

  if (status === "return_window") {
    return (
      <>
        <PanelTitle simulated>Return window</PanelTitle>
        <CountdownRing
          totalSeconds={returnWindowSeconds}
          onComplete={() => onAdvance("released")}
        />
        <p className="mx-auto mt-5 max-w-md text-center text-sm text-muted-foreground">
          The real window would last about 48 hours; this demo shortens it to{" "}
          {returnWindowSeconds} seconds. Funds are released automatically when
          it ends. Dispute handling is planned and not implemented yet.
        </p>
      </>
    );
  }

  return (
    <>
      <PanelTitle simulated>Settlement</PanelTitle>
      <Result icon={PackageCheck} title="Deal complete (simulated)">
        In a real deal the platform would release{" "}
        {formatCurrency(amounts.sellerAmount)} to the seller as a PayPal payout.
        No payout occurred in this demo.
      </Result>
    </>
  );
}
