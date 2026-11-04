import { supabase } from "@/lib/supabase";
import { DEMO_BUYER, DEMO_SELLER, USERS } from "@/lib/mock/data";

/**
 * Retrieves the currently authenticated user from Supabase.
 * If running unauthenticated or offline, gracefully falls back to DEMO_BUYER.
 */
export async function getCurrentUser() {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      let role = user.user_metadata?.role;
      if (!role) {
        // Query public.users to see if role is recorded
        const { data: dbUser } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        if (dbUser?.role) {
          role = dbUser.role;
        }
      }

      return {
        id: user.id,
        email: user.email || "",
        role: role || "buyer",
        name:
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User",
      };
    }
  } catch (err) {
    console.warn("Auth session lookup failed, falling back to demo user:", err);
  }

  return DEMO_BUYER;
}

/**
 * Retrieves the current Supabase session.
 */
export async function getSession() {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  } catch (err) {
    console.warn("Session lookup error:", err);
    return null;
  }
}

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
}
