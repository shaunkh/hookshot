/**
 * RPC retry handler with exponential backoff + jitter for rate-limited RPCs.
 *
 * The Ostium SDK only accepts an `rpcUrl` string, so we can't inject a custom
 * viem transport. Instead, wrap SDK read/write calls with {@link withRpcRetry}
 * to transparently retry when the upstream RPC rejects with a rate-limit error
 * (HTTP 429, JSON-RPC -32005, "too many requests", etc.).
 */

export interface RetryOptions {
  /** Max number of retry attempts after the initial call. Default 5. */
  maxRetries?: number;
  /** Base delay in ms for the first backoff. Default 500. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay in ms. Default 30_000. */
  maxDelayMs?: number;
  /** Called before each retry - useful for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const DEFAULTS = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
} as const;

/** Walk the `.cause` chain and collect status codes + message text. */
function collectErrorInfo(error: unknown): { text: string; statuses: number[] } {
  let text = "";
  const statuses: number[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as Record<string, unknown>;

    if (typeof e.message === "string") text += " " + e.message;

    for (const key of ["status", "statusCode", "code"]) {
      const v = e[key];
      if (typeof v === "number") statuses.push(v);
      else if (typeof v === "string" && /^-?\d+$/.test(v)) statuses.push(Number(v));
    }

    current = e.cause;
  }

  if (typeof error === "string") text += " " + error;
  return { text: text.toLowerCase(), statuses };
}

/** Heuristic: does this error look like an RPC rate-limit / throttle? */
export function isRateLimitError(error: unknown): boolean {
  const { text, statuses } = collectErrorInfo(error);

  // HTTP 429, and the common JSON-RPC "limit exceeded" code -32005.
  if (statuses.includes(429) || statuses.includes(-32005)) return true;

  return (
    text.includes("rate limit") ||
    text.includes("ratelimit") ||
    text.includes("too many requests") ||
    text.includes("429") ||
    text.includes("-32005") ||
    text.includes("request limit") ||
    (text.includes("exceeded") && text.includes("limit")) ||
    text.includes("throttl")
  );
}

/** Extract a `Retry-After` hint (seconds or http-date) from the error, if any. */
function retryAfterMs(error: unknown): number | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as Record<string, unknown>;
    const headers = e.headers as { get?: (k: string) => string | null } | undefined;
    const raw = headers?.get?.("retry-after") ?? (e.retryAfter as string | undefined);
    if (raw != null) {
      const secs = Number(raw);
      if (!Number.isNaN(secs)) return secs * 1000;
      const date = Date.parse(String(raw));
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    }
    current = e.cause;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying with exponential backoff + full jitter on rate-limit errors.
 * Non-rate-limit errors are re-thrown immediately.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isRateLimitError(error)) throw error;

      attempt++;
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      // Full jitter, but never wait less than a Retry-After hint if present.
      const jittered = Math.random() * exp;
      const delayMs = Math.max(retryAfterMs(error) ?? 0, jittered);

      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
