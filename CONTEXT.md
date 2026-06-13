# Ostium Webhook Trader

A hosted, multi-user app. Each **User** logs in, connects their Ostium trading
wallet, delegates trading to a server-held **Delegate** key, and is provisioned a
**Webhook** they can POST **Signals** to from any external app to place trades.
Users manage their own IP allowlist through the UI. Trades execute via
`@ostium/builder-sdk`. State lives in SQLite (for now). The server never custodies
User keys — only the Delegate key (env), which cannot withdraw funds.

## Language

**User**:
An account holder who logs into the app. Each User connects one Ostium trading
identity and can spin up many Webhooks. Multi-tenant: Users are isolated from each
other.
_Avoid_: Operator, tenant, customer

**Account**:
A User's identity in the app, established by Sign-In With Ethereum: connect wallet
+ sign a nonce. The Account address **is** the Trader address — login and on-chain
identity are unified. No passwords are stored.
_Avoid_: Profile, credentials

**Trader**:
The same wallet address, in its on-chain role: the EOA that owns the USDC and
positions on Ostium and signs Delegation. The server stores only this address.
_Avoid_: Wallet, address

**Delegate**:
A single key the server holds (from env) that signs trades on behalf of any User
who has delegated to it. A Delegate can open and close trades but cannot withdraw
funds — so a server breach cannot move User funds. Shared across all Users.
_Avoid_: Bot key, signer, hot wallet

**Delegation**:
The one-time onboarding flow where a User, from their own wallet, approves USDC
and registers the Delegate (via `approveUsdc` + `setDelegate`). Until a User
completes Delegation, their Webhook cannot place trades.
_Avoid_: Authorization, linking

**Signal**:
An inbound instruction to act on a trade, delivered as the body of a webhook POST.
A Signal always carries the same explicit parameter set and addresses a pair +
direction in net base-asset terms (e.g. "long 1.5 BTC", "close 1.2 BTC"). The
server expands it into exact Ostium calls, resolving live price and the underlying
Slots. Signals never reference idx. A Signal is acknowledged fast (persisted, 202)
and executed asynchronously, moving through states: **received → executing →
filled / failed / rejected** (rejected = failed auth or validation, never sent
on-chain).
_Avoid_: Alert, event, message, payload

**Position**:
The app-level aggregate of all open Ostium Slots on one pair + direction, summed
into a single net base-asset size (1.0 BTC slot + 0.5 BTC slot = one 1.5 BTC long
Position). This aggregate is what a User and a Signal see; the underlying Slots
are abstracted away.
_Avoid_: Trade, exposure, net

**Slot**:
A single underlying Ostium position on a pair, identified by `idx`. One aggregated
Position is composed of one or more Slots. Slots are an implementation detail the
app hides from Signals.
_Avoid_: Leg, idx, sub-position

**Size**:
The magnitude of a Signal. Interpreted according to the User's configured **Size
Unit** — base-asset units (1.5 BTC, 10 oz XAU) by default, or USD collateral / USD
notional if the User changes it. For opens the app derives collateral (and from it
leverage/price as needed); for closes the app derives per-Slot `closePercent` from
Size. `"all"` means the full aggregate.
_Avoid_: Amount, quantity, volume, notional

**Size Unit**:
A per-User setting that fixes how every Signal's Size is read: base asset
(default), USD collateral, or USD notional. The Webhook body helper renders the
correct unit for the User's choice.
_Avoid_: Denomination, currency

**Allocation**:
The mapping of a Signal's requested net size onto individual Slots, **largest Slot
first** — e.g. a 1.2 BTC close against a 1.0 + 0.5 Position closes the 1.0 Slot
fully and 0.2 of the 0.5 Slot (40%, leaving 0.3 open), computed as a per-Slot
`closePercent`.
_Avoid_: Distribution, fill, split

**Poster**:
A trusted external source (e.g. a TradingView alert, a bot, a teammate) permitted
to send Signals to a User's Webhook. Posters are gated by IP allowlist and the
Webhook secret; they never hold keys.
_Avoid_: Client, user, sender

**Webhook**:
A named endpoint a User spins up — an unguessable URL id plus a secret. A User can
have many (e.g. one per external app), each with its own secret and IP allowlist,
each individually revocable/rotatable without affecting the others. A Signal is
accepted only when all three hold: the URL id is valid, the body secret matches,
and the source IP is on the Webhook's allowlist.
_Avoid_: Endpoint, hook, route

**Spin up**:
The act of provisioning a new Webhook — the app mints a fresh URL id + secret for
the User to paste into an external app. Revoking destroys a Webhook's URL/secret
so Signals to it are refused.
_Avoid_: Start, launch, deploy

**IP Allowlist**:
A set of allowed source IPs/CIDRs scoped to a **single Webhook** — each URL has its
own, independent of every other Webhook (a User with three URLs has three separate
allowlists). A Signal is refused unless its source IP matches the allowlist of the
exact Webhook it was sent to. The default is **closed to all IPs** (empty list ⇒
deny all), so a fresh Webhook trades nothing until the User adds an IP. The User
can instead deliberately switch a Webhook to **Allow-all** mode, which accepts any
source IP (gated by URL id + secret only). Allow-all is always an explicit opt-in,
never the result of an empty list.
_Avoid_: Whitelist, firewall, global allowlist

**Body Helper**:
An interactive UI that builds a ready-to-paste Signal body for a chosen Webhook —
pre-filled with that Webhook's URL + secret, in the User's Size Unit — plus a
TradingView alert-message template with placeholders. It teaches a Poster exactly
what to send.
_Avoid_: Docs, schema viewer, generator
