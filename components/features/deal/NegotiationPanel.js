"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBubble } from "@/components/features/deal/ChatBubble";

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Negotiation request failed.");
  }
  return body;
}

export function NegotiationPanel({ deal, role }) {
  const router = useRouter();
  const formRef = useRef(null);
  const requestId = useRef(null);

  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetch(`/api/deals/${deal.id}/negotiation`, {
      cache: "no-store",
    })
      .then(jsonResponse)
      .then((body) => {
        if (active) {
          setState(body.negotiation);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
        }
      });

    return () => {
      active = false;
    };
  }, [deal.id, deal.messages?.length]);

  async function start(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const form = new FormData(event.currentTarget);

    try {
      const body = await jsonResponse(
        await fetch(`/api/deals/${deal.id}/negotiation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyerMaximum: form.get("buyerMaximum"),
          }),
        }),
      );

      formRef.current?.reset();
      setState(body.negotiation);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function takeTurn(body = {}) {
    setBusy(true);
    setError("");

    if (!requestId.current) {
      requestId.current = crypto.randomUUID();
    }

    try {
      const result = await jsonResponse(
        await fetch(`/api/deals/${deal.id}/negotiation/turn`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestId.current,
          },
          body: JSON.stringify(body),
        }),
      );

      requestId.current = null;
      setState(result.negotiation);
      router.refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const mode = state?.mode ?? deal.negotiationMode;

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card/50 p-4"
      aria-labelledby="ai-negotiation-heading"
    >
      <header className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-brand-mid" aria-hidden="true" />
        <h2 id="ai-negotiation-heading" className="font-semibold">
          AI negotiation
        </h2>
      </header>

      <p className="text-xs text-muted-foreground">
        AI phrasing is advisory. The seller must propose binding terms and the
        buyer must accept them separately. Your private limit is never sent to
        the other participant or to Google Gemini.
      </p>

      {(!state || state.status === "setup_pending") && role === "buyer" && (
        <form
          ref={formRef}
          onSubmit={start}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="min-w-48 flex-1 text-sm">
            Private maximum (USD)
            <input
              name="buyerMaximum"
              required
              inputMode="decimal"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
              placeholder="e.g. 125.00"
            />
          </label>

          <Button type="submit" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Start negotiation"
            )}
          </Button>
        </form>
      )}

      {(!state || state.status === "setup_pending") && role !== "buyer" && (
        <p className="text-sm text-muted-foreground">
          The buyer has not started negotiation.
        </p>
      )}

      {state && state.status !== "setup_pending" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-muted px-3 py-1">
              {String(state.status).replaceAll("_", " ")}
            </span>
            <span>Round {Math.min(Number(state.round ?? 0), 5)} of 5</span>
          </div>

          <ol
            className="max-h-72 space-y-3 overflow-y-auto"
            aria-label="Negotiation transcript"
          >
            {(deal.messages ?? [])
              .filter((m) =>
                ["buyer", "seller", "buyer_agent", "seller_agent"].includes(
                  m.sender,
                ),
              )
              .map((m, i) => (
                <ChatBubble key={m.id ?? i} sender={m.sender} text={m.text} />
              ))}
          </ol>

          {state.status === "active" &&
            mode === "self_chat" &&
            role === "buyer" &&
            Number(state.round) < 5 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();

                  const form = new FormData(e.currentTarget);
                  const text = String(form.get("text") ?? "");

                  void takeTurn({ text });
                  e.currentTarget.reset();
                }}
                className="flex gap-2"
              >
                <label className="sr-only" htmlFor="negotiation-message">
                  Message the seller agent
                </label>

                <input
                  id="negotiation-message"
                  name="text"
                  required
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Write a message or offer"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2"
                />

                <Button type="submit" disabled={busy} aria-label="Send message">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            )}

          {state.status === "active" &&
            mode === "ai_negotiate" &&
            Number(state.round) < 5 && (
              <Button disabled={busy} onClick={() => takeTurn()}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Run next agent turn"
                )}
              </Button>
            )}

          {state.status === "active" && Number(state.round) >= 5 && (
            <Button disabled={busy} onClick={() => takeTurn()}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Close negotiation"
              )}
            </Button>
          )}

          {state.status === "closed" && (
            <p className="text-sm text-muted-foreground">
              Negotiation is closed without an automatic agreement. If the price
              ranges overlap, the seller may propose final terms below.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
