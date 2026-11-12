
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

const DEMO_EMAIL = "sb-jeyzw53798172@personal.example.com";
const DEMO_PASSWORD = "|qWx.r7/";

export function DemoCredentials({ compact = false }) {
  const [copied, setCopied] = useState("");

  async function copyValue(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-3">
        <h3 className="font-semibold">
          Demo Buyer Credentials
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Use these sample credentials to access the demo buyer account.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="break-all text-sm font-medium">
              {DEMO_EMAIL}
            </p>
          </div>

          <button
            type="button"
            onClick={() => copyValue("email", DEMO_EMAIL)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
          >
            {copied === "email" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied === "email" ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Password</p>
            <p className="break-all text-sm font-medium">
              {DEMO_PASSWORD}
            </p>
          </div>

          <button
            type="button"
            onClick={() => copyValue("password", DEMO_PASSWORD)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
          >
            {copied === "password" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied === "password" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
}
