import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt password hash: `scrypt$N$r$p$salt$hash` (all base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, SCRYPT_COST);
  return [
    "scrypt",
    SCRYPT_COST.N,
    SCRYPT_COST.r,
    SCRYPT_COST.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const derived = scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64url"), SCRYPT_KEYLEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hash, "base64url");
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function serverSecret(): string {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length < 16) {
    // Deterministic dev fallback so the app still runs locally; never acceptable in prod.
    return "haseeb-ai-development-secret-do-not-use-in-production";
  }
  return secret;
}

export function authSecretConfigured(): boolean {
  return (process.env.AUTH_SECRET || "").length >= 32;
}

export function fingerprint(value: string): string {
  return createHmac("sha256", serverSecret()).update(value).digest("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

let cachedKey: Buffer | null = null;
function encryptionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = scryptSync(serverSecret(), "haseeb-ai-integration-secrets", 32, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  }
  return cachedKey;
}

/**
 * Encrypt small secrets (provider tokens entered in Settings) before they are
 * written to the database. Format: `enc.v1.<iv>.<tag>.<ciphertext>` base64url.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["enc", "v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    // Value was stored before encryption existed — treat as plaintext.
    return payload;
  }
  try {
    const [, , ivPart, tagPart, dataPart] = parts;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/** Show only the tail of a secret so the UI can confirm "something is stored". */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return `••••••${value.slice(-4)}`;
}
