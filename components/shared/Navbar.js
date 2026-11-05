"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Handshake, Menu, X, LogOut, LayoutDashboard } from "lucide-react";
import { APP_NAME, NAV_LINKS } from "@/lib/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState("buyer");
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function syncUserSession(session) {
      if (!isMounted) return;
      if (session?.user) {
        setUser(session.user);
        // Display-only: role comes from public.users (never user_metadata). Authorization is server-side.
        let role = null;
        try {
          const { data } = await supabase
            .from("users")
            .select("role")
            .eq("id", session.user.id)
            .maybeSingle();
          role = data?.role ?? null;
        } catch {
          // role stays null
        }
        if (isMounted) {
          setUserRole(role || "buyer");
        }
      } else {
        setUser(null);
        setUserRole("buyer");
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      syncUserSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUserSession(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      setOpen(false);
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.warn("Sign out error:", err);
    } finally {
      setIsSigningOut(false);
    }
  }

  const isActive = (href) =>
    !href.includes("#") &&
    (pathname === href || pathname.startsWith(`${href}/`));

  const dashboardHref = userRole === "seller" ? "/seller/dashboard" : "/buyer/dashboard";
  const dashboardLabel = userRole === "seller" ? "Seller Dashboard" : "Buyer Dashboard";
  const userInitial = user?.email ? user.email[0].toUpperCase() : "U";

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
          {user ? (
            <>
              <div
                className="flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3 py-1.5 text-xs font-medium"
                title={user.email}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-bold text-white uppercase">
                  {userInitial}
                </span>
                <span className="max-w-[130px] truncate text-muted-foreground">
                  {user.email}
                </span>
                <span className="rounded bg-brand-mid/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-mid">
                  {userRole}
                </span>
              </div>

              <Link
                href={dashboardHref}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
                {dashboardLabel}
              </Link>

              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "cursor-pointer text-muted-foreground hover:text-foreground"
                )}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Log in
              </Link>
              <Link href="/signup" className={buttonVariants({ size: "sm" })}>
                Sign up
              </Link>
            </>
          )}
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

          <div className="mt-4 border-t border-border/60 pt-4">
            {user ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1 text-xs">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-bold text-white uppercase">
                    {userInitial}
                  </span>
                  <span className="truncate text-muted-foreground">{user.email}</span>
                  <span className="rounded bg-brand-mid/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-mid">
                    {userRole}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={dashboardHref}
                    onClick={() => setOpen(false)}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
                    Dashboard
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "flex-1 text-muted-foreground")}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
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
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
