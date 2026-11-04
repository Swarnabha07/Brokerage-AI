"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { GlassCard } from "@/components/shared/GlassCard";
import { formatCurrency } from "@/lib/format";
import { getDealAmounts, FEE_RATE_LABEL } from "@/lib/fees";

function validate({ title, description, price }) {
  const errors = {};
  if (title.trim().length < 3)
    errors.title = "Enter a title of at least 3 characters.";
  if (description.trim().length < 10)
    errors.description = "Describe the item in at least 10 characters.";
  const n = Number(price);
  if (!price || Number.isNaN(n) || n <= 0)
    errors.price = "Enter a price greater than 0.";
  else if (n > 100000) errors.price = "Demo listings are limited to $100,000.";
  return errors;
}

export function CreateListingForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    title: "",
    description: "",
    price: "",
    floorPrice: "",
  });
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publishStatus, setPublishStatus] = useState(null);

  const set = (key) => (e) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      setPreview({
        ...values,
        price: Number(values.price),
        floorPrice: values.floorPrice ? Number(values.floorPrice) : null,
      });
    }
  }

  async function handlePublish() {
    setIsSubmitting(true);
    setPublishStatus(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: preview.title,
          description: preview.description,
          price: preview.price,
          floor_price: preview.floorPrice,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to publish listing");
      }

      setPublishStatus({
        type: "success",
        message: "Listing published successfully to Supabase!",
      });

      setTimeout(() => {
        router.push("/listings");
        router.refresh();
      }, 1000);
    } catch (err) {
      setPublishStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Error publishing listing",
      });
      setIsSubmitting(false);
    }
  }

  if (preview) {
    const amounts = getDealAmounts(preview.price);
    return (
      <GlassCard hover={false} className="space-y-5 p-8">
        {publishStatus ? (
          <div
            role="status"
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
              publishStatus.type === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            }`}
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{publishStatus.message}</span>
          </div>
        ) : (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-brand-mid/30 bg-brand-mid/10 p-4 text-sm text-foreground"
          >
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-mid" aria-hidden="true" />
            <span>
              Review your listing details below before publishing to the marketplace.
            </span>
          </div>
        )}

        <div>
          <h2 className="font-display text-xl font-semibold">{preview.title}</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            {preview.description}
          </p>
        </div>

        <dl className="space-y-1.5 rounded-xl border border-border p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Asking price</dt>
            <dd className="font-tabular">{formatCurrency(amounts.price)}</dd>
          </div>
          {preview.floorPrice && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Floor price (negotiation floor)</dt>
              <dd className="font-tabular">{formatCurrency(preview.floorPrice)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Platform fee ({FEE_RATE_LABEL})</dt>
            <dd className="font-tabular">-{formatCurrency(amounts.fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-medium">
            <dt>Buyer pays</dt>
            <dd className="font-tabular">{formatCurrency(amounts.buyerTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Seller receives</dt>
            <dd className="font-tabular">{formatCurrency(amounts.sellerAmount)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handlePublish}
            disabled={isSubmitting || publishStatus?.type === "success"}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing...
              </span>
            ) : (
              "Publish to Marketplace"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setPreview(null)}
            disabled={isSubmitting}
          >
            Edit listing
          </Button>
          <Link href="/seller/dashboard" className={buttonVariants({ variant: "ghost" })}>
            Back to dashboard
          </Link>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard hover={false} className="p-8">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Field label="Title" htmlFor="title" error={errors.title}>
          <Input
            id="title"
            value={values.title}
            onChange={set("title")}
            error={errors.title}
            placeholder="e.g. MacBook Pro 14-inch M2 Pro"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          error={errors.description}
          hint="Condition, specifications, what is included, and shipping notes."
        >
          <Textarea
            id="description"
            value={values.description}
            onChange={set("description")}
            error={errors.description}
            placeholder="Flawless condition, original charger included..."
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asking price (USD)" htmlFor="price" error={errors.price}>
            <Input
              id="price"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.price}
              onChange={set("price")}
              error={errors.price}
              placeholder="1200"
            />
          </Field>
          <Field
            label="Floor price (USD, optional)"
            htmlFor="floorPrice"
            hint="Minimum acceptable price for AI negotiation"
          >
            <Input
              id="floorPrice"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values.floorPrice}
              onChange={set("floorPrice")}
              placeholder="1050"
            />
          </Field>
        </div>
        <Button type="submit" size="lg">
          Review listing
        </Button>
      </form>
    </GlassCard>
  );
}
