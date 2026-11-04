"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { GlassCard } from "@/components/shared/GlassCard";
import { cn } from "@/lib/utils";
import { signInWithGoogle } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase";

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.17 0 9.97 0 12s.45 3.83 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function validate(mode, v) {
  const errors = {};
  if (mode === "signup" && v.name.trim().length < 2)
    errors.name = "Enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(v.email))
    errors.email = "Enter a valid email address.";
  if (v.password.length < 6) errors.password = "Use at least 6 characters.";
  return errors;
}

export function AuthForm({ mode, initialError = "" }) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
    role: "buyer",
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [serverError, setServerError] = useState(initialError);
  const [successMsg, setSuccessMsg] = useState("");

  const set = (key) => (e) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleGoogleLogin() {
    setServerError("");
    setSuccessMsg("");
    setIsGoogleLoading(true);

    try {
      await signInWithGoogle(values.role);
      setSuccessMsg("Connecting with Google...");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to initialize Google authentication.";
      setServerError(msg);
      setIsGoogleLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError("");
    setSuccessMsg("");
    const found = validate(mode, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setIsLoading(true);

    try {
      const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/login";
      const payload = isSignup
        ? { email: values.email, password: values.password, role: values.role }
        : { email: values.email, password: values.password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setServerError(data.error || "Authentication failed. Please check credentials.");
        setIsLoading(false);
        return;
      }

      // Persist Supabase session in the browser client
      if (data.session?.access_token && data.session?.refresh_token) {
        try {
          await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        } catch (sessionErr) {
          console.warn("Could not set browser Supabase session:", sessionErr);
        }
      }

      setSuccessMsg(
        isSignup
          ? "Account created successfully! Redirecting to dashboard..."
          : "Signed in successfully! Redirecting..."
      );

      const targetRole = data.role || values.role;
      setTimeout(() => {
        const destination = targetRole === "seller" ? "/seller/dashboard" : "/buyer/dashboard";
        router.push(destination);
        router.refresh();
      }, 800);
    } catch {
      setServerError("Network error or server unavailable. Redirecting in demo mode...");
      setTimeout(() => {
        router.push(values.role === "seller" ? "/seller/dashboard" : "/buyer/dashboard");
      }, 1200);
    } finally {
      setIsLoading(false);
    }
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

      {serverError && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {serverError}
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="mt-5 rounded-xl border border-success/40 bg-success/10 p-3 text-xs text-success"
        >
          {successMsg}
        </div>
      )}

      {/* Role Selection (on both login & signup) */}
      <div className="mt-6">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            {isSignup ? "I want to" : "Continue as"}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "buyer", label: isSignup ? "Buy" : "Buyer" },
              { value: "seller", label: isSignup ? "Sell" : "Seller" },
            ].map((r) => (
              <label
                key={r.value}
                className={cn(
                  "cursor-pointer rounded-xl border px-4 py-3 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-mid/60",
                  values.role === r.value
                    ? "border-brand-mid bg-brand-mid/10"
                    : "border-border hover:bg-muted"
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={values.role === r.value}
                  onChange={set("role")}
                  className="sr-only"
                  disabled={isLoading || isGoogleLoading}
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Google OAuth Action */}
      <div className="mt-4">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full flex items-center justify-center gap-3 border-border bg-card/60 hover:bg-muted/80 transition-all font-medium cursor-pointer"
          onClick={handleGoogleLogin}
          disabled={isLoading || isGoogleLoading}
        >
          {isGoogleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <GoogleIcon className="h-4 w-4 shrink-0" />
          )}
          <span>Continue with Google</span>
        </Button>
      </div>

      {/* Divider */}
      <div className="relative my-6 flex items-center justify-center">
        <div className="w-full border-t border-border" />
        <span className="absolute bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          or continue with email
        </span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {isSignup && (
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              autoComplete="name"
              value={values.name}
              onChange={set("name")}
              error={errors.name}
              disabled={isLoading || isGoogleLoading}
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
            disabled={isLoading || isGoogleLoading}
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
            disabled={isLoading || isGoogleLoading}
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          className="w-full mt-2"
          disabled={isLoading || isGoogleLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isSignup ? "Creating account..." : "Signing in..."}
            </span>
          ) : isSignup ? (
            "Sign up with Email"
          ) : (
            "Log in with Email"
          )}
        </Button>
      </form>

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
