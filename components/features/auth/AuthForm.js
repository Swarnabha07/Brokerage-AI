"use client";

import { useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { GlassCard } from "@/components/shared/GlassCard";
import { cn } from "@/lib/utils";

function validate(mode, v) {
  const errors = {};
  if (mode === "signup" && v.name.trim().length < 2)
    errors.name = "Enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(v.email))
    errors.email = "Enter a valid email address.";
  if (v.password.length < 8) errors.password = "Use at least 8 characters.";
  return errors;
}

export function AuthForm({ mode }) {
  const isSignup = mode === "signup";
  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
    role: "buyer",
  });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const set = (key) => (e) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const found = validate(mode, values);
    setErrors(found);
    setSubmitted(Object.keys(found).length === 0);
  }

  return (
    <GlassCard hover={false} className="w-full max-w-md p-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSignup
          ? "Choose whether you are here to buy or to sell."
          : "Log in to see your deals."}
      </p>

      <div
        role="note"
        className="mt-5 flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning"
      >
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Authentication is not connected yet. This form only checks your input;
          no account, session or cookie is created.
        </span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        {isSignup && (
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={values.name}
              onChange={set("name")}
              error={errors.name}
            />
          </Field>
        )}
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            error={errors.email}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={values.password}
            onChange={set("password")}
            error={errors.password}
          />
        </Field>

        {isSignup && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">I want to</legend>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: "buyer", label: "Buy" },
                { value: "seller", label: "Sell" },
              ].map((r) => (
                <label
                  key={r.value}
                  className={cn(
                    "cursor-pointer rounded-xl border px-4 py-3 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-mid/60",
                    values.role === r.value
                      ? "border-brand-mid bg-brand-mid/10"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={values.role === r.value}
                    onChange={set("role")}
                    className="sr-only"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Button type="submit" size="lg" className="w-full">
          {isSignup ? "Sign up" : "Log in"}
        </Button>
      </form>

      {submitted && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Input looks valid, but authentication is not connected yet — nothing
          was saved and you are not signed in.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignup ? "Already have an account?" : "New here?"}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="text-foreground underline underline-offset-4"
        >
          {isSignup ? "Log in" : "Sign up"}
        </Link>
      </p>
    </GlassCard>
  );
}
