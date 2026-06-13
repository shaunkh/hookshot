import { assert, assertEquals } from "@std/assert";
import { cidrContains, ipAllowed, parseIp, resolveClientIp } from "./ip.ts";

Deno.test("parseIp handles v4, v6, v4-mapped", () => {
  assertEquals(parseIp("127.0.0.1")?.version, 4);
  assertEquals(parseIp("::1")?.version, 6);
  assertEquals(parseIp("2001:db8::1")?.version, 6);
  // ::ffff:1.2.3.4 normalises to IPv4
  assertEquals(parseIp("::ffff:1.2.3.4")?.version, 4);
  assertEquals(parseIp("::ffff:1.2.3.4")?.value, parseIp("1.2.3.4")?.value);
  assertEquals(parseIp("999.1.1.1"), null);
  assertEquals(parseIp("nonsense"), null);
});

Deno.test("cidrContains v4", () => {
  assert(cidrContains("10.0.0.0/8", "10.5.6.7"));
  assert(!cidrContains("10.0.0.0/8", "11.0.0.1"));
  assert(cidrContains("192.168.1.0/24", "192.168.1.255"));
  assert(!cidrContains("192.168.1.0/24", "192.168.2.1"));
  assert(cidrContains("127.0.0.1/32", "127.0.0.1"));
  assert(!cidrContains("127.0.0.1/32", "127.0.0.2"));
});

Deno.test("cidrContains bare ip = exact match", () => {
  assert(cidrContains("127.0.0.1", "127.0.0.1"));
  assert(!cidrContains("127.0.0.1", "127.0.0.2"));
});

Deno.test("cidrContains v6 + cross-version is false", () => {
  assert(cidrContains("2001:db8::/32", "2001:db8:1234::1"));
  assert(!cidrContains("2001:db8::/32", "2001:db9::1"));
  assert(!cidrContains("10.0.0.0/8", "::1")); // v4 cidr vs v6 ip
});

Deno.test("ipAllowed checks any entry", () => {
  const list = ["10.0.0.0/8", "203.0.113.5/32"];
  assert(ipAllowed("10.1.2.3", list));
  assert(ipAllowed("203.0.113.5", list));
  assert(!ipAllowed("8.8.8.8", list));
  assert(!ipAllowed("8.8.8.8", [])); // empty allowlist denies
});

Deno.test("resolveClientIp only trusts XFF from trusted proxies", () => {
  // direct peer is a trusted proxy → take leftmost XFF
  assertEquals(
    resolveClientIp("10.0.0.1", "203.0.113.9, 10.0.0.1", ["10.0.0.0/8"]),
    "203.0.113.9",
  );
  // peer NOT trusted → ignore XFF (anti-spoof), use socket addr
  assertEquals(
    resolveClientIp("203.0.113.50", "1.2.3.4", ["10.0.0.0/8"]),
    "203.0.113.50",
  );
  // no XFF → socket addr
  assertEquals(resolveClientIp("203.0.113.50", null, ["10.0.0.0/8"]), "203.0.113.50");
});
