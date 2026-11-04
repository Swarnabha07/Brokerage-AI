"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GlassCard } from "@/components/shared/GlassCard";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [statusMessage, setStatusMessage] = useState("Connecting your account...");

  useEffect(() => {
    let isMounted = true;

    async function handleAuth() {
      try {
        const roleParam = searchParams.get("role") || "buyer";
        const code = searchParams.get("code");
        const errorParam = searchParams.get("error");
        const errorDescription = searchParams.get("error_description");

        if (errorParam) {
          throw new Error(errorDescription || errorParam);
        }

        let session = null;

        // 1. If PKCE code is provided in query params, exchange it
        if (code) {
          setStatusMessage("Verifying authorization code...");
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          session = data?.session;
        }

        // 2. Check if session was automatically restored or extracted from hash
        if (!session) {
          const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          session = sessionData?.session;
        }

        // 3. User synchronization function
        const proceedWithUser = async (user) => {
          if (!isMounted) return;
          setStatusMessage("Preparing your dashboard...");

          let finalRole = roleParam;
          try {
            const syncRes = await fetch("/api/auth/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: user.id,
                email: user.email,
                role: roleParam,
                name:
                  user.user_metadata?.full_name ||
                  user.user_metadata?.name ||
                  user.email?.split("@")[0] ||
                  "User",
              }),
            });

            if (syncRes.ok) {
              const syncData = await syncRes.json();
              if (syncData?.role) {
                finalRole = syncData.role;
              }
            }
          } catch (syncErr) {
            console.warn("User sync warning:", syncErr);
          }

          const target =
            finalRole === "seller" ? "/seller/dashboard" : "/buyer/dashboard";
          router.replace(target);
        };

        if (session?.user) {
          await proceedWithUser(session.user);
          return;
        }

        // 4. If session is not immediately available, listen for onAuthStateChange
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (currentSession?.user) {
            subscription.unsubscribe();
            await proceedWithUser(currentSession.user);
          }
        });

        // Safety timeout fallback
        const timeout = setTimeout(() => {
          subscription.unsubscribe();
          if (isMounted) {
            router.replace("/login?error=oauth_timeout");
          }
        }, 5000);

        return () => {
          clearTimeout(timeout);
          subscription.unsubscribe();
        };
      } catch (err) {
        console.error("Auth callback error:", err);
        const msg = err instanceof Error ? err.message : "oauth_failed";
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      }
    }

    handleAuth();

    return () => {
      isMounted = false;
    };
  }, [router, searchParams]);

  return (
    <GlassCard hover={false} className="w-full max-w-md p-8 text-center">
      <div className="flex flex-col items-center justify-center py-6">
        <Loader2 className="h-8 w-8 animate-spin text-brand-mid" />
        <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">
          Signing you in
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{statusMessage}</p>
      </div>
    </GlassCard>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="flex justify-center px-6 py-24">
      <Suspense
        fallback={
          <GlassCard hover={false} className="w-full max-w-md p-8 text-center">
            <div className="flex flex-col items-center justify-center py-6">
              <Loader2 className="h-8 w-8 animate-spin text-brand-mid" />
              <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">
                Signing you in
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Connecting to your account...
              </p>
            </div>
          </GlassCard>
        }
      >
        <CallbackHandler />
      </Suspense>
    </div>
  );
}

