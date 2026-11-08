# PayPal Sandbox smoke test (Gate 1)

Standalone script that proves our Sandbox app and accounts support the whole payment
sequence **before** any application integration: OAuth -> Invoice (sent without
notifications) -> Order -> buyer approval -> Capture + verify -> record payment on the
invoice -> Payout. It imports nothing from the app and needs no new dependencies.

**Sandbox only.** The sole API host in the script is `https://api-m.sandbox.paypal.com`
and it refuses to run unless `PAYPAL_ENVIRONMENT` is exactly `SANDBOX`. No real money.
This is not PayPal escrow; the payout test uses the platform merchant's Sandbox balance.

## Run (Windows PowerShell, Node 20.6+; the project already needs Node 20.9+)

```powershell
node --env-file=.env.local scripts/paypal-sandbox-smoke.mjs
```

Put the variables below in `.env.local` (git-ignored). Do not paste values into the shell.

## Environment variable names (values never printed or committed)

| Variable | Secret? | Meaning |
|---|---|---|
| `PAYPAL_CLIENT_ID` | no | Sandbox app client ID (existing) |
| `PAYPAL_SECRET` | **yes** | Sandbox app secret (existing) |
| `PAYPAL_ENVIRONMENT` | no | Must be exactly `SANDBOX` (existing) |
| `PAYPAL_PLATFORM_BUSINESS_EMAIL` | no | Business sandbox account bound to the app (invoicer / payout sender) |
| `PAYPAL_SMOKE_BUYER_EMAIL` | no | Personal sandbox account that approves the order |
| `PAYPAL_SMOKE_SELLER_EMAIL` | no | Third sandbox account that receives the payout |
| `PAYPAL_SMOKE_POLL_MS` | no | Optional payout polling interval (default 5000) |

The three emails must be three **different** accounts.

## Sandbox account roles

- **Platform Business**: owns the `Brokerage-AI` Merchant app; receives the buyer's capture and funds the payout.
- **Buyer Personal**: logs in on the approval page.
- **Seller account** (Personal or Business): must be a real Sandbox account so the payout is not `UNCLAIMED`.

## Flags

`--status` (print saved progress, no API calls) | `--fresh` (new run) | `--confirm-new-payout`
(needed with `--fresh` if the saved run already started a payout) | `--retry-record` |
`--probe-duplicates` | `--yes` | `--help`

## Safety and resuming

- Progress is saved to `.paypal-smoke-state.json` in the repo root (git-ignored): IDs and step status only, never tokens, secrets or emails.
- Re-running resumes. Completed steps are never repeated. Uncertain create calls are looked up or retried with the same idempotency key, never blindly re-created. A started payout is only ever re-read.
- A payout is reported `SUCCESS` only when the **item** status is `SUCCESS`. `PENDING`, `UNCLAIMED`, `FAILED`, `DENIED`, `CANCELED` are reported distinctly.
- Do not run two copies at once.
- Exit codes: `0` success, `1` failure, `2` paused/pending/inconclusive, `3` config error.

## Identity checks (fail closed)

The script compares the identities PayPal returns with your configured accounts. Emails are
trimmed and compared case-insensitively. Only the words `MATCH`, `MISMATCH` or `UNAVAILABLE`
are printed or saved, never the addresses.

| Check | Compared with | When |
|---|---|---|
| Invoicer on the invoice | `PAYPAL_PLATFORM_BUSINESS_EMAIL` | Before the invoice is sent, again at the end of Step B, and before Step E |
| Payee on the order | `PAYPAL_PLATFORM_BUSINESS_EMAIL` | Before capture and again after capture |
| Payer on the order | `PAYPAL_SMOKE_BUYER_EMAIL` | Before capture (if PayPal already shows it) and again after capture |

- **`MISMATCH`** stops the workflow (exit code 1). Where it can be seen before capture, the order is **not** captured. A mismatch found only after capture means the money moved, so the script prints the order and capture IDs, refuses to record the invoice payment, and makes no payout.
- A recorded mismatch is **sticky**: re-running cannot clear it, even if PayPal later omits or corrects the field. Fix the configuration and start over with `--fresh`.
- **`UNAVAILABLE`** means PayPal did not return that field. It is not treated as a mismatch, but the summary states that the identity was **not independently verified**.
- The invoicer is weaker evidence than the payee, because the script supplies the invoicer email itself. The payee and payer are returned by PayPal independently.

## During the run

At Step C the script prints an approval URL and pauses. Open it in a private window, log in
as the **buyer** Personal sandbox account, approve, and press Enter (redirect to
`example.com` is expected). The script re-checks PayPal that the order is `APPROVED` before capturing.
