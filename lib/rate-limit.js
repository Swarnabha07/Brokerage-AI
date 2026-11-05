import "server-only";

/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Scope: single Node.js process. Good enough to blunt naive credential-stuffing /
 * brute-force scripts against auth routes in a demo/hackathon deployment. It does
 * NOT survive a restart and does NOT share state across multiple instances — if you
 * deploy with more than one server process (e.g. serverless, multi-region, PM2
 * cluster mode), swap this for a shared store (Redis / Upstash / Supabase table)
 * keyed the same way.
 */

const buckets = new Map(); // key -> array of request timestamps (ms)

// Periodically forget keys with no recent activity so this Map can't grow forever.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, timestamps] of buckets) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
}

/**
 * @param {string} key        Unique bucket key, e.g. `login:${ip}` or `login:${ip}:${email}`.
 * @param {number} limit      Max requests allowed inside the window.
 * @param {number} windowMs   Window size in milliseconds.
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  sweep(now);

  const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
    buckets.set(key, timestamps);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP from standard proxy headers; falls back to a constant bucket. */
export function getClientIp(request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
