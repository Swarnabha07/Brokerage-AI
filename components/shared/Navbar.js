"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Handshake, Menu, X } from "lucide-react";
import { APP_NAME, NAV_LINKS } from "@/lib/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2"
      aria-label={`${APP_NAME} home`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
        <Handshake className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="font-display text-base font-semibold tracking-tight">
        Brokerage<span className="text-gradient">AI</span>
      </span>
    </Link>
  );
}

/** Static placeholder shown while the pathname resolves (required by Cache Components). */
export function NavbarFallback() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center px-6">
        <Brand />
      </div>
    </header>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href) =>
    !href.includes("#") &&
    (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Brand />

        <nav
          aria-label="Main"
          className="hidden items-center gap-7 text-sm md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "transition-colors hover:text-foreground",
                isActive(link.href)
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Log in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: "sm" })}>
            Sign up
          </Link>
        </div>

        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="border-t border-border/60 bg-background px-6 py-4 md:hidden"
        >
          <ul className="space-y-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-2.5 text-sm hover:bg-muted",
                    isActive(link.href)
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "flex-1",
              )}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ size: "sm" }), "flex-1")}
            >
              Sign up
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
