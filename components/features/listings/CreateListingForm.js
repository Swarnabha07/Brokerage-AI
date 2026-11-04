"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
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
  const [values, setValues] = useState({
    title: "",
    description: "",
    price: "",
  });
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);

  const set = (key) => (e) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length === 0)
      setPreview({ ...values, price: Number(values.price) });
  }

  if (preview) {
    const amounts = getDealAmounts(preview.price);
    return (
      <GlassCard hover={false} className="space-y-5 p-8">
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            Demo mode — this listing was not saved or published. It disappears
            when you leave this page.
          </span>
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold">
            {preview.title}
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
            {preview.description}
          </p>
        </div>
        <dl className="space-y-1.5 rounded-xl border border-border p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Asking price (your amount)
            </dt>
            <dd className="font-tabular">
              {formatCurrency(amounts.sellerAmount)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Buyer fee, demo assumption ({FEE_RATE_LABEL})
            </dt>
            <dd className="font-tabular">{formatCurrency(amounts.fee)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-medium">
            <dt>Buyer would pay</dt>
            <dd className="font-tabular">
              {formatCurrency(amounts.buyerTotal)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setPreview(null)}>
            Edit listing
          </Button>
          <Link href="/seller/dashboard" className={buttonVariants({})}>
            Back to seller dashboard
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
            placeholder="e.g. iPhone 12 — 128GB"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          error={errors.description}
          hint="Condition, what is included, and delivery notes."
        >
          <Textarea
            id="description"
            value={values.description}
            onChange={set("description")}
            error={errors.description}
          />
        </Field>
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
            placeholder="300"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Demo mode — submitting only shows a preview. Nothing is saved or
          published.
        </p>
        <Button type="submit" size="lg">
          Preview listing
        </Button>
      </form>
    </GlassCard>
  );
}
