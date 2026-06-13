/**
 * Stateless signed sessions (HMAC-SHA256 over a base64url JSON payload) + cookie
 * helpers. Framework-agnostic: routes read the Cookie header and set Set-Cookie.
 */
import { getConfig } from "../env.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  userId: string;
  exp: number; // unix ms
}

function b64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  return (keyPromise ??= crypto.subtle.importKey(
    "raw",
    bs(getConfig().sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  ));
}

export async function signSession(session: Session): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(), bs(enc.encode(payload))),
  );
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string): Promise<Session | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      bs(b64urlDecode(sig)),
      bs(enc.encode(payload)),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const s = JSON.parse(dec.decode(b64urlDecode(payload))) as Session;
    if (typeof s.userId !== "string" || typeof s.exp !== "number") return null;
    if (Date.now() > s.exp) return null;
    return s;
  } catch {
    return null;
  }
}

export function buildSetCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (getConfig().cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(cookieHeader: string | null, name = SESSION_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
