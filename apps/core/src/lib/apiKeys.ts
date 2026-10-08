import { createHmac, randomBytes } from "node:crypto";
import { hashToken } from "./tokens.js";

/**
 * Chave de API pública por workspace (F5): `ark_live_<público>.<segredo>`.
 * O segredo é devolvido UMA vez na criação; só o SHA-256 dele é persistido.
 * O prefixo permite reconhecer a chave na UI sem expor nada.
 */
export interface GeneratedApiKey {
  /** Chave completa — enviar ao cliente agora e nunca mais. */
  key: string;
  prefix: string;
  keyHash: string;
}

export function generateApiKey(env: "live" | "test" = "live"): GeneratedApiKey {
  const publicPart = randomBytes(4).toString("hex");
  const secretPart = randomBytes(24).toString("hex");
  const key = `ark_${env}_${publicPart}.${secretPart}`;
  return { key, prefix: `ark_${env}_${publicPart}`, keyHash: hashToken(key) };
}

/** Segredo HMAC de um endpoint de webhook (assina o payload de saída). */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Assinatura do payload: `sha256=<hex>` sobre `<timestamp>.<corpo>`.
 * Mesmo formato do webhook do GitHub, que todo SDK já sabe verificar.
 */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}