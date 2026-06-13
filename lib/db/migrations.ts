/**
 * Ordered, idempotent schema migrations. Index = version. NEVER reorder or edit
 * an applied entry — only append. Applied versions are tracked in `_migrations`.
 *
 * Conventions: addresses lowercased; timestamps unix-ms integers; booleans 0/1;
 * money/price values stored as decimal TEXT (never float/INTEGER) to avoid drift
 * and the node:sqlite >2^53 read error.
 */
import { getDb, transaction } from "./sqlite.ts";

export const MIGRATIONS: readonly string[] = [
  // 0 — users (Account = wallet via SIWE; trader_addr is login + on-chain identity)
  `CREATE TABLE users (
     id            TEXT PRIMARY KEY,
     trader_addr   TEXT NOT NULL UNIQUE,
     size_unit     TEXT NOT NULL DEFAULT 'base'
                     CHECK (size_unit IN ('base','usd_collateral','usd_notional')),
     default_leverage TEXT,
     created_at    INTEGER NOT NULL,
     last_login_at INTEGER
   );`,

  // 1 — single-use SIWE login nonces
  `CREATE TABLE siwe_nonces (
     nonce      TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL,
     consumed   INTEGER NOT NULL DEFAULT 0
   );`,

  // 2 — webhooks (many per user; secret AES-GCM encrypted at rest)
  `CREATE TABLE webhooks (
     id            TEXT PRIMARY KEY,
     user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name          TEXT NOT NULL,
     secret_enc    BLOB NOT NULL,
     allow_mode    TEXT NOT NULL DEFAULT 'allowlist'
                     CHECK (allow_mode IN ('allowlist','allow_all')),
     active        INTEGER NOT NULL DEFAULT 1,
     created_at    INTEGER NOT NULL,
     secret_rotated_at INTEGER
   );`,
  `CREATE INDEX idx_webhooks_user ON webhooks(user_id);`,

  // 3 — per-webhook IP allowlist (empty ⇒ deny all unless allow_mode='allow_all')
  `CREATE TABLE webhook_ips (
     id         TEXT PRIMARY KEY,
     webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
     cidr       TEXT NOT NULL,
     label      TEXT,
     created_at INTEGER NOT NULL
   );`,
  `CREATE INDEX idx_webhook_ips_hook ON webhook_ips(webhook_id);`,

  // 4 — signals (every accepted/rejected attempt; raw body retained for audit)
  `CREATE TABLE signals (
     id          TEXT PRIMARY KEY,
     webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
     user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     action      TEXT,
     symbol      TEXT,
     side        TEXT,
     raw_body    TEXT NOT NULL,
     body_hash   TEXT NOT NULL,
     client_id   TEXT,
     status      TEXT NOT NULL
                   CHECK (status IN ('received','executing','filled','failed','rejected','partial')),
     reason      TEXT,
     source_ip   TEXT NOT NULL,
     received_at INTEGER NOT NULL,
     executed_at INTEGER
   );`,
  `CREATE INDEX idx_signals_user_time ON signals(user_id, received_at DESC);`,
  `CREATE INDEX idx_signals_webhook_time ON signals(webhook_id, received_at DESC);`,
  `CREATE INDEX idx_signals_dedup ON signals(webhook_id, body_hash, received_at);`,
  `CREATE UNIQUE INDEX idx_signals_clientid ON signals(webhook_id, client_id)
     WHERE client_id IS NOT NULL;`,

  // 5 — per-tx fan-out results for a signal
  `CREATE TABLE signal_txs (
     id          TEXT PRIMARY KEY,
     signal_id   TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
     seq         INTEGER NOT NULL,
     kind        TEXT NOT NULL
                   CHECK (kind IN ('openTrade','closeTrade','modifyTp','modifySl','cancelOrder')),
     pair_id     TEXT NOT NULL,
     idx         INTEGER,
     params_json TEXT NOT NULL,
     status      TEXT NOT NULL CHECK (status IN ('pending','submitted','failed')),
     tx_hash     TEXT,
     error       TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   );`,
  `CREATE INDEX idx_signal_txs_signal ON signal_txs(signal_id, seq);`,

  // 6 — delegation cache (chain is source of truth; allowance re-read live)
  `CREATE TABLE delegations (
     user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     delegate_safe  TEXT NOT NULL,
     usdc_approved  INTEGER NOT NULL DEFAULT 0,
     delegate_set   INTEGER NOT NULL DEFAULT 0,
     approve_tx     TEXT,
     set_delegate_tx TEXT,
     checked_at     INTEGER
   );`,

  // 7 — bind a SIWE nonce to the address that requested it (defense in depth)
  `ALTER TABLE siwe_nonces ADD COLUMN address TEXT;`,
];

/** Apply any not-yet-applied migrations in order. Returns count newly applied. */
export function runMigrations(migrations: readonly string[] = MIGRATIONS): number {
  const db = getDb();
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`,
  );
  const last = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as {
    v: number | null;
  };
  const start = last.v === null ? 0 : last.v + 1;

  let applied = 0;
  for (let v = start; v < migrations.length; v++) {
    transaction(() => {
      db.exec(migrations[v]);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(v, Date.now());
    });
    applied++;
  }
  return applied;
}
