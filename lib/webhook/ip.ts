/**
 * IPv4/IPv6 parsing + CIDR matching for per-webhook IP allowlists, plus
 * client-IP resolution that only trusts X-Forwarded-For from configured proxies.
 *
 * Security-critical: the IP allowlist is one of the three webhook gates, so a
 * spoofable source IP would defeat it. We trust XFF ONLY when the direct peer is
 * a configured trusted proxy; otherwise we use the socket's remote address.
 */

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

export function parseIp(input: string): ParsedIp | null {
  const s = input.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    return { version: 4, value: parts.reduce((a, n) => (a << 8n) | BigInt(n), 0n) };
  }
  if (s.includes(":")) {
    const v = parseV6(s);
    if (v === null) return null;
    // Normalise IPv4-mapped (::ffff:a.b.c.d) to IPv4 so it matches v4 allowlists.
    if (v >> 32n === 0xffffn) return { version: 4, value: v & 0xffffffffn };
    return { version: 6, value: v };
  }
  return null;
}

function parseV6(input: string): bigint | null {
  let str = input;
  // Convert an embedded IPv4 tail to two hextets.
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(input);
  if (m) {
    const v4 = parseIp(m[2]);
    if (!v4 || v4.version !== 4) return null;
    const hi = (v4.value >> 16n) & 0xffffn;
    const lo = v4.value & 0xffffn;
    str = m[1] + hi.toString(16) + ":" + lo.toString(16);
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  let all: number[];
  if (halves.length === 2) {
    const left = groups(halves[0]);
    const right = groups(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    all = [...left, ...Array(missing).fill(0), ...right];
  } else {
    const g = groups(halves[0]);
    if (!g) return null;
    all = g;
  }
  if (all.length !== 8) return null;
  return all.reduce((a, g) => (a << 16n) | BigInt(g), 0n);
}

/** Does `ip` fall within `cidr` (e.g. "10.0.0.0/8", "1.2.3.4", "::1/128")? */
export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.lastIndexOf("/");
  const addr = parseIp(ip);
  if (!addr) return false;
  if (slash === -1) {
    const base = parseIp(cidr);
    return !!base && base.version === addr.version && base.value === addr.value;
  }
  const base = parseIp(cidr.slice(0, slash));
  const prefix = Number(cidr.slice(slash + 1));
  if (!base || base.version !== addr.version) return false;
  const bits = base.version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
  if (prefix === 0) return true;
  const shift = BigInt(bits - prefix);
  return base.value >> shift === addr.value >> shift;
}

/** True if `ip` matches any allowlist entry. */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  return allowlist.some((cidr) => cidrContains(cidr, ip));
}

/**
 * Resolve the effective client IP. If the direct peer (`remoteAddr`) is a
 * trusted proxy, take the left-most X-Forwarded-For entry (the original client);
 * otherwise the socket address is authoritative.
 */
/** Strip a `[v6]:port` / `v4:port` wrapper from an X-Forwarded-For entry. */
function stripPort(entry: string): string {
  const s = entry.trim();
  if (s.startsWith("[")) {
    const close = s.indexOf("]");
    return close > 0 ? s.slice(1, close) : s; // [2001:db8::1]:443 → 2001:db8::1
  }
  if ((s.match(/:/g)?.length ?? 0) === 1) return s.split(":")[0]; // 1.2.3.4:443 → 1.2.3.4
  return s; // bare IPv4 or bare IPv6
}

export function resolveClientIp(
  remoteAddr: string,
  xff: string | null,
  trustedProxies: string[],
): string {
  if (xff && trustedProxies.some((t) => cidrContains(t, remoteAddr))) {
    const first = xff.split(",")[0];
    if (first && first.trim()) return stripPort(first);
  }
  return remoteAddr;
}
