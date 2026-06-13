/**
 * Integration test for the DB + crypto + env stack against a real (temp) SQLite
 * file: migrations, prepared-statement CRUD, the encrypted-secret round-trip,
 * scoping, and idempotency lookups.
 */
import { assert, assertEquals } from "@std/assert";

// Configure env BEFORE any getConfig() (which is lazy on first DB use).
const tmpDir = Deno.makeTempDirSync();
Deno.env.set("DELEGATE_PRIVATE_KEY", "0x" + "11".repeat(32));
Deno.env.set("SESSION_SECRET", "x".repeat(48));
Deno.env.set("SECRET_ENC_KEY", "ab".repeat(32)); // 32 bytes hex
Deno.env.set("DB_PATH", `${tmpDir}/test.db`);

const { runMigrations } = await import("./migrations.ts");
const repo = await import("./repo.ts");
const { encryptSecret, decryptSecret } = await import("../crypto.ts");
const { closeDb } = await import("./sqlite.ts");

Deno.test("db stack: migrate, users, webhooks, secrets, signals", async (t) => {
  const applied = runMigrations();
  assert(applied > 0, "migrations should apply on a fresh db");
  assertEquals(runMigrations(), 0, "second run is a no-op");

  await t.step("upsert user is idempotent on address", () => {
    const u1 = repo.upsertUser("0xABC0000000000000000000000000000000000001");
    const u2 = repo.upsertUser("0xabc0000000000000000000000000000000000001"); // case-insensitive
    assertEquals(u1.id, u2.id);
    assertEquals(u1.trader_addr, "0xabc0000000000000000000000000000000000001");
    assertEquals(u1.size_unit, "base");
  });

  await t.step("webhook secret round-trips through AES-GCM at rest", async () => {
    const user = repo.getUserByAddress("0xabc0000000000000000000000000000000000001")!;
    const secret = "whsec_supersecret";
    const enc = await encryptSecret(secret);
    const wh = repo.createWebhook(user.id, "tv-btc", enc);
    assertEquals(wh.allow_mode, "allowlist");
    assertEquals(wh.active, 1);

    const fetched = repo.getActiveWebhook(wh.id)!;
    assert(fetched.secret_enc instanceof Uint8Array);
    assertEquals(await decryptSecret(fetched.secret_enc), secret);
  });

  await t.step("ip allowlist + allow-mode toggle scoped to user", () => {
    const user = repo.getUserByAddress("0xabc0000000000000000000000000000000000001")!;
    const [wh] = repo.listWebhooks(user.id);
    repo.addWebhookIp(wh.id, "127.0.0.1/32", "localhost");
    assertEquals(repo.listWebhookIps(wh.id).length, 1);
    assert(repo.setAllowMode(wh.id, user.id, "allow_all"));
    assert(!repo.setAllowMode(wh.id, "someone-else", "allowlist"), "cross-user mutation blocked");
    assertEquals(repo.getWebhook(wh.id)!.allow_mode, "allow_all");
  });

  await t.step("signals: create, status, idempotency lookups", () => {
    const user = repo.getUserByAddress("0xabc0000000000000000000000000000000000001")!;
    const [wh] = repo.listWebhooks(user.id);
    const sig = repo.createSignal({
      webhookId: wh.id,
      userId: user.id,
      rawBody: '{"action":"open"}',
      bodyHash: "hash123",
      clientId: "bar-1",
      sourceIp: "127.0.0.1",
      status: "received",
      action: "open",
      symbol: "BTC/USD",
      side: "B",
    });
    assertEquals(sig.status, "received");
    repo.updateSignal(sig.id, { status: "filled", executedAt: Date.now() });
    assertEquals(repo.getSignal(sig.id)!.status, "filled");
    assert(repo.clientIdExists(wh.id, "bar-1"));
    assert(!repo.clientIdExists(wh.id, "bar-2"));
    assert(repo.hasRecentIdenticalBody(wh.id, "hash123", 0));
    assertEquals(repo.listSignals(user.id).length, 1);
  });

  await t.step("signal_txs fan-out rows", () => {
    const user = repo.getUserByAddress("0xabc0000000000000000000000000000000000001")!;
    const sig = repo.listSignals(user.id)[0];
    const tx = repo.createSignalTx({
      signalId: sig.id,
      seq: 0,
      kind: "closeTrade",
      pairId: "0",
      idx: 1,
      paramsJson: "{}",
    });
    repo.updateSignalTx(tx.id, "submitted", "0xdeadbeef", null);
    const txs = repo.listSignalTxs(sig.id);
    assertEquals(txs.length, 1);
    assertEquals(txs[0].status, "submitted");
    assertEquals(txs[0].tx_hash, "0xdeadbeef");
  });

  await t.step("delegations upsert + flags", () => {
    const user = repo.getUserByAddress("0xabc0000000000000000000000000000000000001")!;
    repo.upsertDelegation(user.id, "0xSAFE00000000000000000000000000000000000a");
    repo.setUsdcApproved(user.id, true, "0xapprove");
    const d = repo.getDelegation(user.id)!;
    assertEquals(d.usdc_approved, 1);
    assertEquals(d.delegate_set, 0);
    assertEquals(d.approve_tx, "0xapprove");
  });

  closeDb();
  await Deno.remove(tmpDir, { recursive: true });
});
