/**
 * Cryptographic helpers (WebCrypto only).
 *
 * - Unguessable ids + webhook secrets.
 * - SHA-256 + constant-time hex compare for ingest secret checks.
 * - AES-GCM encrypt/decrypt of webhook secrets at rest (key from env).
 *
 * Importing this module is side-effect free; the AES key is imported lazily on
 * first encrypt/decrypt (so env is only read when secrets are actually used).
 */
import { getConfig } from "./env.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

// WebCrypto wants `BufferSource`; TS 5.7 types byte arrays as
// `Uint8Array<ArrayBufferLike>` which it won't narrow. Runtime-safe cast.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

function b64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe random id. `bytes` of entropy → ~1.33×bytes chars. */
export function randomId(bytes = 18): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** A webhook secret with an identifiable prefix. */
export function randomSecret(): string {
  return "whsec_" + randomId(32);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Constant-time secret comparison via SHA-256 (avoids leaking length/content).
 * Used on the webhook ingest path to compare a provided secret to the stored one.
 */
export async function secretsMatch(provided: string, actual: string): Promise<boolean> {
  const [pa, ac] = await Promise.all([sha256Hex(provided), sha256Hex(actual)]);
  return timingSafeEqualHex(pa, ac);
}

let keyPromise: Promise<CryptoKey> | null = null;
function aesKey(): Promise<CryptoKey> {
  return (keyPromise ??= crypto.subtle.importKey(
    "raw",
    bs(getConfig().secretEncKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  ));
}

/** AES-GCM encrypt → blob laid out as iv(12) || ciphertext+tag. */
export async function encryptSecret(plaintext: string): Promise<Uint8Array> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(enc.encode(plaintext))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptSecret(blob: Uint8Array): Promise<string> {
  const key = await aesKey();
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ct));
  return dec.decode(pt);
}
