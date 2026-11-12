# Transaction Intelligence

`/analytics` is an authenticated, read-only buyer and seller workspace built with AG Studio 3.1.0. The page obtains the verified Supabase user on the server and scopes deal and listing reads to that user's stored role. `/api/analytics` exposes the same sanitized, private no-store payload for clients that need it.

Payment totals use only `payments.status = captured` and its verified `captured_at` timestamp. Seller payable values use immutable `invoices.price_cents`; paid out totals use `payouts.status = succeeded` and `amount_cents`. Pending payout combines captured deal amounts that remain in held lifecycle states with actual pending payout records. The app schema has no listing active/inactive flag, so seller listings are counted as listing rows, not inferred active statuses.

AG Studio receives purpose-built datasets with transaction titles, lifecycle, dates and financial summaries only. It never receives raw dashboard objects, payment or payout provider identifiers, payout destinations, listing floor prices, buyer budgets, or negotiation messages. Users can edit, resize and cross-filter the built-in AG Studio charts and grids. Layout state is not persisted between sessions.

AG Studio can be used locally without a licence key. For a licensed deployment, request a trial licence from AG Grid and configure `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` in local `.env.local` and in Vercel project environment variables. No Supabase schema or policy changes are required.
