/**
 * Fixed-point decimal math on strings, BigInt-backed, to avoid float drift in
 * money/price calculations. All inputs/outputs are plain decimal strings (the
 * form the Ostium SDK consumes). Internal precision is 30 fractional digits.
 */
const SCALE = 30;
const SCALE_F = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function toScaled(s: string): bigint {
  if (!DECIMAL_RE.test(s)) throw new Error(`not a decimal string: ${JSON.stringify(s)}`);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [int, frac = ""] = body.split(".");
  const fracPadded = (frac + "0".repeat(SCALE)).slice(0, SCALE);
  const v = BigInt(int || "0") * SCALE_F + BigInt(fracPadded || "0");
  return neg ? -v : v;
}

/** Format a scale-30 bigint to a decimal string rounded half-up to `dp` places. */
function fromScaled(v: bigint, dp = 18): string {
  const neg = v < 0n;
  let abs = neg ? -v : v;
  const drop = BigInt(SCALE - dp);
  if (drop > 0n) {
    const divisor = 10n ** drop;
    const rem = abs % divisor;
    abs = abs / divisor;
    if (rem * 2n >= divisor) abs += 1n; // round half up
  } else if (drop < 0n) {
    abs = abs * 10n ** -drop;
  }
  const unit = 10n ** BigInt(dp);
  const intPart = abs / unit;
  let out = intPart.toString();
  if (dp > 0) {
    const f = (abs % unit).toString().padStart(dp, "0").replace(/0+$/, "");
    if (f.length) out += "." + f;
  }
  return neg && abs !== 0n ? "-" + out : out;
}

export function mulStr(a: string, b: string, dp = 18): string {
  return fromScaled((toScaled(a) * toScaled(b)) / SCALE_F, dp);
}

export function divStr(a: string, b: string, dp = 18): string {
  const bb = toScaled(b);
  if (bb === 0n) throw new Error("division by zero");
  return fromScaled((toScaled(a) * SCALE_F) / bb, dp);
}

/** (a * b) / c in one shot, preserving precision before rounding to `dp`. */
export function mulDivStr(a: string, b: string, c: string, dp = 18): string {
  const cc = toScaled(c);
  if (cc === 0n) throw new Error("division by zero");
  return fromScaled((toScaled(a) * toScaled(b)) / cc, dp);
}

export function addStr(a: string, b: string, dp = 18): string {
  return fromScaled(toScaled(a) + toScaled(b), dp);
}

export function subStr(a: string, b: string, dp = 18): string {
  return fromScaled(toScaled(a) - toScaled(b), dp);
}

export function cmpStr(a: string, b: string): -1 | 0 | 1 {
  const A = toScaled(a), B = toScaled(b);
  return A < B ? -1 : A > B ? 1 : 0;
}

export function minStr(a: string, b: string): string {
  return cmpStr(a, b) <= 0 ? a : b;
}

export function isPositiveStr(s: string): boolean {
  return toScaled(s) > 0n;
}

/**
 * `take / total * 100` FLOORED to 2 decimal places, capped at 100. Flooring
 * guarantees a per-Slot close never exceeds what was requested (so the aggregate
 * can't over-close); the SDK accepts fractional percent (→ basis points). Returns
 * 0 for dust - the caller skips such legs. (ADR 0002.)
 */
export function closePercent(take: string, total: string): number {
  const t = toScaled(total);
  if (t <= 0n) return 0;
  const hundredths = (toScaled(take) * 10000n) / t; // floor(take/total * 10000)
  let p = Number(hundredths) / 100; // 2dp percent
  if (p > 100) p = 100;
  return p;
}

/** Parse "BTC/USD" → { from: "BTC", to: "USD" }; null if malformed. */
export function parseSymbol(s: string): { from: string; to: string } | null {
  const m = /^([A-Z0-9]+)\/([A-Z0-9]+)$/.exec(s.trim().toUpperCase());
  return m ? { from: m[1], to: m[2] } : null;
}

export function bigintToHex(v: bigint): `0x${string}` {
  return `0x${v.toString(16)}`;
}
