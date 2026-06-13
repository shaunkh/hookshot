/**
 * Typed data access. Thin functions over the query helpers in sqlite.ts; rows
 * map straight onto the Row types in lib/types.ts (booleans are 0/1 integers,
 * the secret blob is a Uint8Array). All ids are generated here with randomId().
 */
import { queryAll, queryOne, run } from "./sqlite.ts";
import { randomId } from "../crypto.ts";
import type {
  AllowMode,
  DelegationRow,
  Side,
  SignalAction,
  SignalRow,
  SignalStatus,
  SignalTxKind,
  SignalTxRow,
  SignalTxStatus,
  SizeUnit,
  UserRow,
  WebhookIpRow,
  WebhookRow,
} from "../types.ts";

const now = () => Date.now();

// ── Users ─────────────────────────────────────────────────────────────────
export function upsertUser(traderAddr: string): UserRow {
  const addr = traderAddr.toLowerCase();
  const existing = getUserByAddress(addr);
  if (existing) {
    run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), existing.id);
    return { ...existing, last_login_at: now() };
  }
  const id = randomId();
  run(
    "INSERT INTO users (id, trader_addr, size_unit, default_leverage, created_at, last_login_at) VALUES (?, ?, 'base', NULL, ?, ?)",
    id,
    addr,
    now(),
    now(),
  );
  return getUserById(id)!;
}

export function getUserByAddress(addr: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE trader_addr = ?", addr.toLowerCase());
}

export function getUserById(id: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function setSizeUnit(userId: string, unit: SizeUnit): void {
  run("UPDATE users SET size_unit = ? WHERE id = ?", unit, userId);
}

export function setDefaultLeverage(userId: string, leverage: string | null): void {
  run("UPDATE users SET default_leverage = ? WHERE id = ?", leverage, userId);
}

// ── SIWE nonces ─────────────────────────────────────────────────────────────
export function createNonce(address: string): string {
  run("DELETE FROM siwe_nonces WHERE created_at < ?", now() - 60 * 60_000); // GC stale
  const nonce = randomId(24);
  run(
    "INSERT INTO siwe_nonces (nonce, created_at, consumed, address) VALUES (?, ?, 0, ?)",
    nonce,
    now(),
    address.toLowerCase(),
  );
  return nonce;
}

/** Consume a nonce if unused, fresh, AND bound to `address`. Returns true if valid. */
export function consumeNonce(nonce: string, address: string, maxAgeMs = 10 * 60_000): boolean {
  const cutoff = now() - maxAgeMs;
  const res = run(
    "UPDATE siwe_nonces SET consumed = 1 WHERE nonce = ? AND consumed = 0 AND created_at >= ? AND address = ?",
    nonce,
    cutoff,
    address.toLowerCase(),
  );
  return res.changes === 1;
}

// ── Webhooks ──────────────────────────────────────────────────────────────
export function createWebhook(userId: string, name: string, secretEnc: Uint8Array): WebhookRow {
  const id = randomId();
  run(
    "INSERT INTO webhooks (id, user_id, name, secret_enc, allow_mode, active, created_at, secret_rotated_at) VALUES (?, ?, ?, ?, 'allowlist', 1, ?, NULL)",
    id,
    userId,
    name,
    secretEnc,
    now(),
  );
  return getWebhook(id)!;
}

export function getWebhook(id: string): WebhookRow | undefined {
  return queryOne<WebhookRow>("SELECT * FROM webhooks WHERE id = ?", id);
}

export function getActiveWebhook(id: string): WebhookRow | undefined {
  return queryOne<WebhookRow>("SELECT * FROM webhooks WHERE id = ? AND active = 1", id);
}

export function listWebhooks(userId: string): WebhookRow[] {
  return queryAll<WebhookRow>(
    "SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC",
    userId,
  );
}

/** All mutations are scoped by user_id so one User can never touch another's. */
export function renameWebhook(id: string, userId: string, name: string): boolean {
  return run("UPDATE webhooks SET name = ? WHERE id = ? AND user_id = ?", name, id, userId)
    .changes === 1;
}

export function setAllowMode(id: string, userId: string, mode: AllowMode): boolean {
  return run("UPDATE webhooks SET allow_mode = ? WHERE id = ? AND user_id = ?", mode, id, userId)
    .changes === 1;
}

export function setWebhookActive(id: string, userId: string, active: boolean): boolean {
  return run(
    "UPDATE webhooks SET active = ? WHERE id = ? AND user_id = ?",
    active ? 1 : 0,
    id,
    userId,
  ).changes === 1;
}

export function rotateSecret(id: string, userId: string, secretEnc: Uint8Array): boolean {
  return run(
    "UPDATE webhooks SET secret_enc = ?, secret_rotated_at = ? WHERE id = ? AND user_id = ?",
    secretEnc,
    now(),
    id,
    userId,
  ).changes === 1;
}

export function deleteWebhook(id: string, userId: string): boolean {
  return run("DELETE FROM webhooks WHERE id = ? AND user_id = ?", id, userId).changes === 1;
}

// ── Webhook IPs ─────────────────────────────────────────────────────────────
export function addWebhookIp(webhookId: string, cidr: string, label: string | null): WebhookIpRow {
  const id = randomId();
  run(
    "INSERT INTO webhook_ips (id, webhook_id, cidr, label, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    webhookId,
    cidr,
    label,
    now(),
  );
  return queryOne<WebhookIpRow>("SELECT * FROM webhook_ips WHERE id = ?", id)!;
}

export function listWebhookIps(webhookId: string): WebhookIpRow[] {
  return queryAll<WebhookIpRow>(
    "SELECT * FROM webhook_ips WHERE webhook_id = ? ORDER BY created_at",
    webhookId,
  );
}

export function deleteWebhookIp(id: string, webhookId: string): boolean {
  return run("DELETE FROM webhook_ips WHERE id = ? AND webhook_id = ?", id, webhookId).changes ===
    1;
}

// ── Signals ─────────────────────────────────────────────────────────────────
export interface CreateSignalInput {
  webhookId: string;
  userId: string;
  rawBody: string;
  bodyHash: string;
  clientId: string | null;
  sourceIp: string;
  status: SignalStatus;
  reason?: string | null;
  action?: SignalAction | null;
  symbol?: string | null;
  side?: Side | null;
}

export function createSignal(input: CreateSignalInput): SignalRow {
  const id = randomId();
  run(
    `INSERT INTO signals
       (id, webhook_id, user_id, action, symbol, side, raw_body, body_hash, client_id, status, reason, source_ip, received_at, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    input.webhookId,
    input.userId,
    input.action ?? null,
    input.symbol ?? null,
    input.side ?? null,
    input.rawBody,
    input.bodyHash,
    input.clientId,
    input.status,
    input.reason ?? null,
    input.sourceIp,
    now(),
  );
  return getSignal(id)!;
}

export interface UpdateSignalPatch {
  status?: SignalStatus;
  reason?: string | null;
  action?: SignalAction | null;
  symbol?: string | null;
  side?: Side | null;
  executedAt?: number | null;
}

export function updateSignal(id: string, patch: UpdateSignalPatch): void {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.status !== undefined) (sets.push("status = ?"), vals.push(patch.status));
  if (patch.reason !== undefined) (sets.push("reason = ?"), vals.push(patch.reason));
  if (patch.action !== undefined) (sets.push("action = ?"), vals.push(patch.action));
  if (patch.symbol !== undefined) (sets.push("symbol = ?"), vals.push(patch.symbol));
  if (patch.side !== undefined) (sets.push("side = ?"), vals.push(patch.side));
  if (patch.executedAt !== undefined) (sets.push("executed_at = ?"), vals.push(patch.executedAt));
  if (!sets.length) return;
  vals.push(id);
  run(`UPDATE signals SET ${sets.join(", ")} WHERE id = ?`, ...vals);
}

export function getSignal(id: string): SignalRow | undefined {
  return queryOne<SignalRow>("SELECT * FROM signals WHERE id = ?", id);
}

export function listSignals(userId: string, limit = 100): SignalRow[] {
  return queryAll<SignalRow>(
    "SELECT * FROM signals WHERE user_id = ? ORDER BY received_at DESC LIMIT ?",
    userId,
    limit,
  );
}

/** For boot crash-recovery: signals stuck mid-flight. */
export function listUnfinishedSignals(): SignalRow[] {
  return queryAll<SignalRow>(
    "SELECT * FROM signals WHERE status IN ('received','executing') ORDER BY received_at",
  );
}

export function hasRecentIdenticalBody(
  webhookId: string,
  bodyHash: string,
  sinceMs: number,
): boolean {
  return queryOne<{ x: number }>(
    "SELECT 1 AS x FROM signals WHERE webhook_id = ? AND body_hash = ? AND received_at >= ? LIMIT 1",
    webhookId,
    bodyHash,
    sinceMs,
  ) !== undefined;
}

export function clientIdExists(webhookId: string, clientId: string): boolean {
  return queryOne<{ x: number }>(
    "SELECT 1 AS x FROM signals WHERE webhook_id = ? AND client_id = ? LIMIT 1",
    webhookId,
    clientId,
  ) !== undefined;
}

// ── Signal txs ───────────────────────────────────────────────────────────────
export interface CreateSignalTxInput {
  signalId: string;
  seq: number;
  kind: SignalTxKind;
  pairId: string;
  idx: number | null;
  paramsJson: string;
}

export function createSignalTx(input: CreateSignalTxInput): SignalTxRow {
  const id = randomId();
  const t = now();
  run(
    `INSERT INTO signal_txs (id, signal_id, seq, kind, pair_id, idx, params_json, status, tx_hash, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    id,
    input.signalId,
    input.seq,
    input.kind,
    input.pairId,
    input.idx,
    input.paramsJson,
    t,
    t,
  );
  return queryOne<SignalTxRow>("SELECT * FROM signal_txs WHERE id = ?", id)!;
}

export function updateSignalTx(
  id: string,
  status: SignalTxStatus,
  txHash: string | null,
  error: string | null,
): void {
  run(
    "UPDATE signal_txs SET status = ?, tx_hash = ?, error = ?, updated_at = ? WHERE id = ?",
    status,
    txHash,
    error,
    now(),
    id,
  );
}

export function listSignalTxs(signalId: string): SignalTxRow[] {
  return queryAll<SignalTxRow>(
    "SELECT * FROM signal_txs WHERE signal_id = ? ORDER BY seq",
    signalId,
  );
}

// ── Delegations ──────────────────────────────────────────────────────────────
export function upsertDelegation(userId: string, delegateSafe: string): DelegationRow {
  run(
    `INSERT INTO delegations (user_id, delegate_safe, usdc_approved, delegate_set, checked_at)
     VALUES (?, ?, 0, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET delegate_safe = excluded.delegate_safe`,
    userId,
    delegateSafe.toLowerCase(),
    now(),
  );
  return getDelegation(userId)!;
}

export function getDelegation(userId: string): DelegationRow | undefined {
  return queryOne<DelegationRow>("SELECT * FROM delegations WHERE user_id = ?", userId);
}

export function setUsdcApproved(userId: string, approved: boolean, approveTx: string | null): void {
  run(
    "UPDATE delegations SET usdc_approved = ?, approve_tx = COALESCE(?, approve_tx), checked_at = ? WHERE user_id = ?",
    approved ? 1 : 0,
    approveTx,
    now(),
    userId,
  );
}

export function setDelegateRegistered(userId: string, set: boolean, setTx: string | null): void {
  run(
    "UPDATE delegations SET delegate_set = ?, set_delegate_tx = COALESCE(?, set_delegate_tx), checked_at = ? WHERE user_id = ?",
    set ? 1 : 0,
    setTx,
    now(),
    userId,
  );
}
