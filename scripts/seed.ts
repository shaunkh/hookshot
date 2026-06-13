/**
 * Dev seed: create a test user + two webhooks (one with an IP allowlist, one
 * without) so the ingest gates can be exercised with curl. Prints their ids and
 * the shared plaintext secret. Run: deno run -A scripts/seed.ts
 */
import "@std/dotenv/load";
import { runMigrations } from "@/lib/db/migrations.ts";
import { addWebhookIp, createWebhook, upsertUser } from "@/lib/db/repo.ts";
import { encryptSecret } from "@/lib/crypto.ts";

runMigrations();

const SECRET = "whsec_test";
const user = upsertUser("0x000000000000000000000000000000000000beef");

const withIps = createWebhook(user.id, "with-ips", await encryptSecret(SECRET));
addWebhookIp(withIps.id, "127.0.0.1/32", "localhost-v4");
addWebhookIp(withIps.id, "::1/128", "localhost-v6");

const noIps = createWebhook(user.id, "no-ips", await encryptSecret(SECRET));

console.log(JSON.stringify({ withIps: withIps.id, noIps: noIps.id, secret: SECRET }));
