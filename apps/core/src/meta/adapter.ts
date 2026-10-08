import { createHmac } from "node:crypto";
import { safeEqualHex } from "../lib/secrets.js";

/**
 * Adapter isolado da Meta oficial (Messenger + Instagram via Graph API v21+).
 * O core NUNCA fala HTTP direto com a Meta: tudo passa por esta interface.
 * (Mesmo padrão do adapter WAHA em `src/waha/`.)
 */

export type MetaChannel = "messenger" | "instagram";

export interface MetaPageInfo {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
}

export interface MetaAdapter {
  readonly kind: string;
  /** URL de início do OAuth (o usuário autoriza a Página). */
  buildOAuthUrl(input: { workspaceId: string }): string;
  /** Troca `code` do OAuth por token de usuário. */
  exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; expiresIn: number | null }>;
  /** Páginas que o usuário administra (para escolher qual conectar). */
  listPages(input: { userAccessToken: string }): Promise<MetaPageInfo[]>;
  /** Conta do Instagram vinculada à Página (pode não existir). */
  getLinkedInstagram(input: {
    pageId: string;
    pageAccessToken: string;
  }): Promise<string | null>;
  /** Envio de texto (Messenger e IG usam a mesma Send API da Página). */
  sendText(input: {
    channel: MetaChannel;
    pageAccessToken: string;
    recipientId: string;
    text: string;
  }): Promise<{ externalId: string }>;
}

/** Mensagem normalizada de webhook (Messenger ou Instagram). */
export interface NormalizedMetaMessage {
  pageId: string;
  channel: MetaChannel;
  senderId: string;
  mid: string;
  text: string | null;
  /** Eco de mensagem enviada pela própria Página (nunca vira intake). */
  isEcho: boolean;
  timestamp: number | null;
}

function messageText(message: Record<string, unknown>): string | null {
  if (typeof message.text === "string" && message.text.trim() !== "") {
    return message.text;
  }
  return null;
}

function extractSenderId(item: Record<string, unknown>): string {
  const sender = item.sender as { id?: unknown } | undefined;
  return sender && typeof sender.id === "string" ? sender.id : "";
}

function extractMid(item: Record<string, unknown>): { message: Record<string, unknown> | undefined; mid: string } {
  const message = item.message as Record<string, unknown> | undefined;
  const mid = message && typeof message.mid === "string" ? message.mid : "";
  return { message, mid };
}

function extractTimestamp(item: Record<string, unknown>): number | null {
  if (typeof item.timestamp === "number") return item.timestamp;
  if (typeof item.timestamp === "string" && item.timestamp !== "") {
    return Number(item.timestamp);
  }
  return null;
}

function normalizeMessagingEntry(
  object: string,
  pageId: string,
  item: Record<string, unknown>,
): NormalizedMetaMessage | null {
  const channel: MetaChannel = object === "instagram" ? "instagram" : "messenger";
  const senderId = extractSenderId(item);
  const { message, mid } = extractMid(item);
  if (!senderId || !mid) return null;
  return {
    pageId,
    channel,
    senderId,
    mid,
    text: message ? messageText(message) : null,
    isEcho: message?.is_echo === true,
    timestamp: extractTimestamp(item),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function collectEntryEvents(
  object: string,
  entry: Record<string, unknown>,
  out: NormalizedMetaMessage[],
): void {
  const pageId = typeof entry.id === "string" ? entry.id : "";
  if (!pageId) return;
  const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
  for (const rawItem of messaging) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const event = normalizeMessagingEntry(object, pageId, item);
    if (event) out.push(event);
  }
}

/**
 * Normaliza o envelope do webhook da Meta
 * (`{ object: "page"|"instagram", entry: [{ id, messaging: [...] }] }`).
 * Eventos sem remetente/mid são descartados; ecos são marcados `isEcho`.
 */
export function normalizeMetaWebhook(body: unknown): NormalizedMetaMessage[] {
  if (typeof body !== "object" || body === null) return [];
  const root = body as Record<string, unknown>;
  const object = typeof root.object === "string" ? root.object : "";
  if (object !== "page" && object !== "instagram") return [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const out: NormalizedMetaMessage[] = [];
  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    collectEntryEvents(object, entry, out);
  }
  return out;
}

/**
 * Verifica `X-Hub-Signature-256: sha256=<hmac do corpo com o app secret>`.
 * Quando não há app secret configurado, a verificação é pulada (dev).
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string | null,
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqualHex(signatureHeader, expected);
}

/** Verificação do webhook (GET da Meta): devolve o challenge ou null. */
export function verifyMetaSubscribe(
  query: Record<string, unknown>,
  verifyToken: string | null,
): string | null {
  if (!verifyToken) return null;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
    return challenge;
  }
  return null;
}
