# Delegate-key custody, never user keys

The server holds a single shared **Delegate** key (from env) and uses Ostium's
delegated + gasless mode to place trades on behalf of any User who has delegated to
it. Users connect their own wallet in the browser and complete Delegation
(`approveUsdc` + `setDelegate`) themselves; the server never sees, stores, or
transmits a User's main private key - only each User's Trader **address**.

## Considered Options

- **Custody users' main private keys (encrypted at rest).** Rejected: a server
  breach (or a leaked encryption key) drains every User's funds. Maximum blast
  radius for a webhook box that is, by design, exposed to the internet.
- **A per-User generated key.** Rejected: still custody, N secrets to protect and
  rotate, and it doesn't reduce the "can move funds" risk.
- **Shared Delegate key + gasless delegation (chosen).** A Delegate can open and
  close trades but cannot withdraw funds. A breach lets an attacker grief (trade)
  but not steal. One secret to protect. Gas is sponsored via Ostium's Pimlico
  endpoint, so the server holds no ETH.

The Delegate key lives in the `.env` for now - a deliberate simplicity choice. It
can later be moved behind a hardware-backed KMS/HSM (e.g. cloud KMS, signing only,
key never exported) without changing the custody model: it is still one
trade-only Delegate, just held more securely. Because the key only signs trades -
not withdrawals - `.env` is an acceptable starting point.

## Consequences

- Onboarding requires a one-time on-chain Delegation per User; until done, that
  User's Webhooks cannot trade.
- Users delegate to the Delegate's **Safe** address (gasless mode), not the EOA.
- The threat model for the host is "attacker can place/close trades," not "attacker
  can drain funds" - IP allowlist + per-Webhook secret + the Active toggle are the
  controls that matter most.
