/**
 * node:sqlite singleton + prepared-statement cache + transaction helper.
 *
 * Built into Deno >= 2.8 (no --unstable flag). Running against a file DB needs
 * --allow-read --allow-write on the DB directory (WAL writes -wal/-shm siblings).
 */
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "../env.ts";

type Stmt = ReturnType<DatabaseSync["prepare"]>;

let _db: DatabaseSync | null = null;
const _stmts = new Map<string, Stmt>();

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const path = getConfig().dbPath;
  if (path !== ":memory:") {
    const dir = path.replace(/\/[^/]*$/, "");
    if (dir && dir !== path) {
      try {
        Deno.mkdirSync(dir, { recursive: true });
      } catch {
        // already exists / not permitted - surfaced later by the open
      }
    }
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  _db = db;
  return db;
}

/** Prepared statements are cached by SQL text for the lifetime of the connection. */
export function prepare(sql: string): Stmt {
  const cached = _stmts.get(sql);
  if (cached) return cached;
  const s = getDb().prepare(sql);
  _stmts.set(sql, s);
  return s;
}

/** SQLite bind value. */
export type Bind = number | bigint | string | null | Uint8Array;

/** Query helpers that map node:sqlite's untyped rows onto our Row types. */
export function queryOne<T>(sql: string, ...params: Bind[]): T | undefined {
  return prepare(sql).get(...params) as unknown as T | undefined;
}

export function queryAll<T>(sql: string, ...params: Bind[]): T[] {
  return prepare(sql).all(...params) as unknown as T[];
}

/** Execute a write; returns affected row count + last insert rowid (as numbers). */
export function run(sql: string, ...params: Bind[]): { changes: number; lastInsertRowid: number } {
  const r = prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** BEGIN/COMMIT with automatic ROLLBACK on throw. Not re-entrant (no nesting). */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function closeDb(): void {
  _db?.close();
  _db = null;
  _stmts.clear();
}
