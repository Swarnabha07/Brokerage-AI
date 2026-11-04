import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";
import { HeroShape } from "@/components/shared/HeroShape";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  CallToAction,
  Features,
  HowItWorks,
} from "@/components/features/landing/sections";
import { DEMO_DEAL_ID } from "@/lib/config";
import { DEAL_STATUS_ORDER } from "@/lib/constants/deal-status";

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-mesh" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-6 pb-16 pt-16 lg:grid-cols-2 lg:pt-24">
          <div className="space-y-8">
            <Badge variant="brand">
              <FlaskConical className="h-3 w-3" aria-hidden="true" /> Frontend
              demo — sample data
            </Badge>
            <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Deals negotiated by{" "}
              <span className="text-gradient">AI agents</span>, built around
              PayPal.
            </h1>
            <p className="max-w-lg text-lg text-muted-foreground">
              Brokerage AI helps buyers and sellers negotiate structured deals,
              then manages the invoice, payment hold and payout steps. This demo
              shows the intended experience; no real payments are processed.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href={`/deal/${DEMO_DEAL_ID}`}
                className={buttonVariants({ size: "lg" })}
              >
                Open the sample deal{" "}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/listings"
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                Browse sample listings
              </Link>
            </div>
            <dl className="flex gap-10 pt-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  Lifecycle stages
                </dt>
                <dd className="font-display text-2xl font-semibold">
                  {DEAL_STATUS_ORDER.length}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Scoped AI agents
                </dt>
                <dd className="font-display text-2xl font-semibold">2</dd>
              </div>
            </dl>
          </div>
          <HeroShape />
        </div>
      </section>

      <HowItWorks />
      <Features />
      <CallToAction />
    </>
  );
}
