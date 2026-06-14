/**
 * Shared domain + persistence types for Hookshot.
 *
 * See CONTEXT.md for the glossary. These types are deliberately framework-free so
 * every layer (db, ostium, signal, worker, routes) can depend on them without
 * pulling in Fresh/viem/sqlite.
 */

/** How a User's Signal `size` is interpreted. Per-User setting; default `base`. */
export type SizeUnit = "base" | "usd_collateral" | "usd_notional";

/** Long/short as expressed by a Poster in a Signal. */
export type Direction = "long" | "short";

/** On-chain side as Ostium reports it: `B` = long, `S` = short. */
export type Side = "B" | "S";

/** The four things a Signal can ask for. */
export type SignalAction = "open" | "close" | "modify" | "cancel";

/** Order type for opens (mirrors Ostium `OrderType`). */
export type OrderKind = "market" | "limit" | "stop";

/** Lifecycle of a Signal. `rejected` = never sent on-chain. `partial` = some fan-out txs filled, some failed. */
export type SignalStatus =
  | "received"
  | "executing"
  | "filled"
  | "failed"
  | "rejected"
  | "partial";

/** Per-webhook IP gate mode. `allowlist` (default, empty ⇒ deny all) or explicit `allow_all`. */
export type AllowMode = "allowlist" | "allow_all";

/** Kind of a single on-chain fan-out call recorded in `signal_txs`. */
export type SignalTxKind =
  | "openTrade"
  | "closeTrade"
  | "modifyTp"
  | "modifySl"
  | "cancelOrder";

/** Status of one fan-out tx. */
export type SignalTxStatus = "pending" | "submitted" | "failed";

export const SIZE_UNITS: readonly SizeUnit[] = ["base", "usd_collateral", "usd_notional"];

export function directionToSide(d: Direction): Side {
  return d === "long" ? "B" : "S";
}

export function directionToBuy(d: Direction): boolean {
  return d === "long";
}

// ── Persistence row shapes (mirror lib/db/migrations.ts) ──────────────────────

export interface UserRow {
  id: string;
  trader_addr: string; // lowercased 0x address; = login = on-chain trader
  size_unit: SizeUnit;
  default_leverage: string | null; // decimal string
  created_at: number; // unix ms
  last_login_at: number | null;
}

export interface WebhookRow {
  id: string; // unguessable URL id (path /h/{id})
  user_id: string;
  name: string;
  secret_enc: Uint8Array; // AES-GCM blob (iv || ciphertext+tag)
  allow_mode: AllowMode;
  active: number; // 0/1
  created_at: number;
  secret_rotated_at: number | null;
}

export interface WebhookIpRow {
  id: string;
  webhook_id: string;
  cidr: string; // single IP stored as /32 or /128
  label: string | null;
  created_at: number;
}

export interface SignalRow {
  id: string;
  webhook_id: string;
  user_id: string; // denormalized for fast dashboard scope
  action: SignalAction | null; // null if body never parsed
  symbol: string | null;
  side: Side | null;
  raw_body: string; // exact bytes received
  body_hash: string; // sha256 hex (10s dup suppression)
  client_id: string | null; // optional idempotency key
  status: SignalStatus;
  reason: string | null; // rejection/failure detail; "duplicate" for idempotency
  source_ip: string;
  received_at: number;
  executed_at: number | null;
}

export interface SignalTxRow {
  id: string;
  signal_id: string;
  seq: number;
  kind: SignalTxKind;
  pair_id: string;
  idx: number | null; // Slot idx (null for open)
  params_json: string; // exact SDK params sent
  status: SignalTxStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DelegationRow {
  user_id: string;
  delegate_safe: string;
  usdc_approved: number; // 0/1 last-checked
  delegate_set: number; // 0/1 last-checked
  approve_tx: string | null;
  set_delegate_tx: string | null;
  checked_at: number | null;
}
