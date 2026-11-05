/**
 * CLIENT-side auth helpers. Identity is always verified server-side (lib/auth/server.ts);
 * nothing here is trusted for authorization.
 */
import { supabase } from "@/lib/supabase";

/**
 * Initiates Google OAuth sign-in flow via Supabase Auth.
 * Redirects user to Google OAuth consent screen and then back to /auth/callback.
 *
 * @param {('buyer'|'seller')} [role='buyer'] - The role to register/associate if new user
 */
export async function signInWithGoogle(role = "buyer") {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectTo = `${origin}/auth/callback?role=${encodeURIComponent(role)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Logs in a user via the backend auth API.
 */
export async function loginUser(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Login failed");
  }

  return data;
}

/**
 * Registers a new user via the backend auth API.
 */
export async function signupUser(email, password, role = "buyer", name = "") {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, role, name }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Signup failed");
  }

  return data;
}

/**
 * Signs out the current user session.
 */
export async function logoutUser() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("Sign out error:", err);
  }

  try {
    if (typeof window !== "undefined") {
      await fetch("/api/auth/logout", { method: "POST" });
    }
  } catch (err) {
    console.warn("Logout cookie clearance failed:", err);
  }
}
