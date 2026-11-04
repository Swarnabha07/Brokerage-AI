import {
  Bot,
  ShieldCheck,
  Lock,
  PackageCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { GlassCard } from "@/components/shared/GlassCard";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_DEAL_ID } from "@/lib/config";

const steps = [
  {
    icon: Bot,
    title: "Agents negotiate",
    desc: "Your AI agent and the seller’s agent discuss price and terms, or you chat directly.",
  },
  {
    icon: ShieldCheck,
    title: "Seller approves terms",
    desc: "Agreed terms become a structured summary. The seller approves them before an invoice is created.",
  },
  {
    icon: Lock,
    title: "Payment is held",
    desc: "The buyer pays and the platform holds the funds with its own application logic until delivery is confirmed.",
  },
  {
    icon: PackageCheck,
    title: "Deal settles",
    desc: "After delivery and a return window, the funds are released to the seller as a payout.",
  },
];

const features = [
  {
    icon: Sparkles,
    title: "Dual AI negotiation",
    desc: "Two scoped agents, one per side, negotiate within a capped number of rounds.",
  },
  {
    icon: Zap,
    title: "Designed for PayPal Sandbox APIs",
    desc: "The planned backend uses PayPal’s Orders, Invoicing and Payouts APIs. This frontend demo does not call them yet.",
  },
  {
    icon: Lock,
    title: "Conditional release",
    desc: "Hold-and-release is our own application logic. PayPal has no native escrow product, and this is not legal escrow.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20"
    >
      <div className="mb-14 space-y-3 text-center">
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Four steps from first message to settled funds
        </h2>
        <p className="text-muted-foreground">
          The intended deal lifecycle, shown with sample data in this demo.
        </p>
      </div>
      <ol className="grid gap-6 md:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title}>
            <GlassCard delay={i * 0.08} className="h-full p-6">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-white">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="mb-2 font-display text-xs font-medium text-brand-mid">
                Step {i + 1}
              </div>
              <h3 className="mb-2 font-display text-base font-semibold">
                {step.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.desc}
              </p>
            </GlassCard>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Features() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <div className="grid items-center gap-14 md:grid-cols-2">
        <div className="space-y-6">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Honest about what is real
            <br /> and what is planned.
          </h2>
          <p className="max-w-md text-muted-foreground">
            This build is a frontend demo with sample data. The AI layer decides
            what to negotiate; the payment steps are designed around PayPal’s
            sandbox APIs and will be verified by the backend before any real
            state is shown.
          </p>
          <ul className="space-y-5 pt-2">
            {features.map((f) => (
              <li key={f.title} className="flex gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <f.icon
                    className="h-4 w-4 text-brand-mid"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <div className="font-medium">{f.title}</div>
                  <div className="text-sm text-muted-foreground">{f.desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <GlassCard className="p-8" hover={false}>
          <div className="mb-6 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Planned agent permissions (design)
            </span>
            <span
              className="h-2 w-2 rounded-full bg-warning"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-4">
            {[
              {
                name: "Buyer Agent",
                tools: ["orders.create", "orders.get", "orders.capture"],
              },
              {
                name: "Seller Agent",
                tools: ["invoices.create", "invoices.send", "payouts.create"],
              },
            ].map((agent) => (
              <div
                key={agent.name}
                className="rounded-xl border border-border p-4"
              >
                <div className="mb-2 text-sm font-semibold">{agent.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

export function CallToAction() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <GlassCard
        hover={false}
        className="relative overflow-hidden px-10 py-16 text-center"
      >
        <div className="pointer-events-none absolute inset-0 bg-mesh opacity-60" />
        <h2 className="relative font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Walk through a sample deal.
        </h2>
        <p className="relative mx-auto mt-3 max-w-md text-muted-foreground">
          Step through the full lifecycle as a buyer or a seller. Every action
          is simulated and nothing is saved.
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href={`/deal/${DEMO_DEAL_ID}`}
            className={buttonVariants({ size: "lg" })}
          >
            Open the sample deal
          </Link>
          <Link
            href="/listings"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Browse sample listings
          </Link>
        </div>
      </GlassCard>
    </section>
  );
}
