import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Segredos por workspace (page access token da Meta, senhas SMTP/IMAP).
 * Cifra AES-256-GCM com chave derivada (SHA-256) de um segredo do ambiente
 * (JWT_SECRET). Formato: `v1.<iv-b64>.<tag-b64>.<cipher-b64>`.
 * A API nunca devolve o texto cifrado — só status/ids.
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  if (!secret) throw new Error("segredo_de_cifra_ausente");
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string, secret: string): string {
  if (!secret) throw new Error("segredo_de_cifra_ausente");
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("segredo_formato_invalido");
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const enc = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Últimos 4 chars para exibir na UI sem expor o segredo. */
export function secretLast4(secret: string): string {
  const clean = secret.trim();
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
}

/** Compara HMAC SHA-256 em tempo constante (webhook da Meta). */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
