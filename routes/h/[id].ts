/**
 * Webhook ingest - the only public, session-less endpoint. Triple gate:
 *   1. URL id exists & active        (else 404)
 *   2. body `secret` matches          (else 401)
 *   3. source IP allowed              (else 403, recorded as rejected)
 * Then idempotency, persist `received`, 202, and enqueue for async execution.
 *
 * Posters (e.g. TradingView) can't send custom headers, so the secret travels in
 * the JSON body and the id in the path.
 *
 * Hardening:
 *  - No DB write happens before the secret gate passes (prevents an unauthenticated
 *    DB-fill DoS from anyone who merely learns the URL id).
 *  - The stored `raw_body` has the `secret` field REDACTED, so a DB-file read can
 *    never recover live secrets (preserving the AES-GCM-at-rest guarantee).
 *  - Request bodies are size-capped; the worker queue sheds load with 429.
 */
import { define } from "@/utils.ts";
import { getConfig } from "@/lib/env.ts";
import { createSignal, getActiveWebhook, listWebhookIps } from "@/lib/db/repo.ts";
import { sha256Hex } from "@/lib/crypto.ts";
import { ipOk, secretOk } from "@/lib/webhook/auth.ts";
import { resolveClientIp } from "@/lib/webhook/ip.ts";
import { duplicateReason } from "@/lib/webhook/idempotency.ts";
import { enqueue, queueDepth } from "@/lib/worker/runner.ts";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUEUE_DEPTH = 1000;

function sourceIpOf(ctx: { info: Deno.ServeHandlerInfo; req: Request }): string {
  const remote = (ctx.info.remoteAddr as Deno.NetAddr).hostname;
  const xff = ctx.req.headers.get("x-forwarded-for");
  return resolveClientIp(remote, xff, getConfig().trustedProxyIps);
}

/** Re-serialize the body with the secret stripped - what we persist/display. */
function redact(parsed: Record<string, unknown>): string {
  const { secret: _omit, ...rest } = parsed;
  return JSON.stringify(rest);
}

export const handler = define.handlers({
  async POST(ctx) {
    const webhook = getActiveWebhook(ctx.params.id);
    if (!webhook) return ctx.json({ error: "not found" }, { status: 404 });

    // Size cap (before reading/hashing) - bounds memory + DB writes.
    const declared = Number(ctx.req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return ctx.json({ error: "body too large" }, { status: 413 });
    const raw = await ctx.req.text();
    if (raw.length > MAX_BODY_BYTES) return ctx.json({ error: "body too large" }, { status: 413 });

    // Gate 2 (secret) is checked with NO DB write, so a known id alone can't fill the DB.
    let parsed: Record<string, unknown>;
    try {
      const j = JSON.parse(raw);
      if (typeof j !== "object" || j === null) throw new Error("not an object");
      parsed = j as Record<string, unknown>;
    } catch {
      return ctx.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const secret = typeof parsed.secret === "string" ? parsed.secret : "";
    if (!secret || !(await secretOk(webhook, secret))) {
      return ctx.json({ error: "invalid secret" }, { status: 401 });
    }

    // Authenticated from here. Persist with the secret REDACTED.
    const safeBody = redact(parsed);
    const bodyHash = await sha256Hex(raw);
    const sourceIp = sourceIpOf(ctx);
    const clientId = typeof parsed.clientId === "string" ? parsed.clientId : null;

    const record = (status: "rejected", reason: string) =>
      createSignal({
        webhookId: webhook.id,
        userId: webhook.user_id,
        rawBody: safeBody,
        bodyHash,
        clientId: null,
        sourceIp,
        status,
        reason,
      });

    // Gate 3: source IP.
    if (!ipOk(webhook, listWebhookIps(webhook.id), sourceIp)) {
      record("rejected", "source IP not allowed");
      return ctx.json({ error: "source IP not allowed" }, { status: 403 });
    }

    // Idempotency.
    const dup = duplicateReason(webhook.id, clientId, bodyHash);
    if (dup) {
      record("rejected", dup);
      return ctx.json({ ok: true, duplicate: true }, { status: 202 });
    }

    // Backpressure: shed load rather than grow an unbounded queue.
    if (queueDepth() >= MAX_QUEUE_DEPTH) {
      return ctx.json({ error: "server busy, retry later" }, { status: 429 });
    }

    // Accept: persist `received` and enqueue. UNIQUE index backstops a clientId race.
    try {
      const signal = createSignal({
        webhookId: webhook.id,
        userId: webhook.user_id,
        rawBody: safeBody,
        bodyHash,
        clientId,
        sourceIp,
        status: "received",
      });
      enqueue(signal.id);
      return ctx.json({ ok: true, signalId: signal.id }, { status: 202 });
    } catch {
      return ctx.json({ ok: true, duplicate: true }, { status: 202 });
    }
  },
});
