/**
 * Adapter isolado do gateway WhatsApp. Hoje: WAHA (engine GOWS).
 * Depois: Cloud API oficial — basta uma nova implementação desta interface.
 * O core NUNCA fala HTTP direto com o WAHA: tudo passa por aqui.
 */

export interface WahaSessionInfo {
  name: string;
  status: string;
  phone?: string | null;
}

export interface WahaQrInfo {
  /** QR em base64 (png) ou HTML, conforme o engine. */
  qr: string | null;
  status: string;
}

export interface WhatsAppAdapter {
  readonly kind: string;
  createSession(name: string): Promise<WahaSessionInfo>;
  getStatus(name: string): Promise<WahaSessionInfo>;
  getQr(name: string): Promise<WahaQrInfo>;
  reconnect(name: string): Promise<WahaSessionInfo>;
  logout(name: string): Promise<void>;
}

/** Evento normalizado de webhook/qualquer adapter futuro. */
export type NormalizedWahaEvent =
  | {
      type: "message";
      session: string;
      messageId: string | null;
      from: string;
      text: string | null;
      mediaUrl: string | null;
      fromMe: boolean;
    }
  | { type: "session.status"; session: string; status: string; phone?: string | null }
  | { type: "unknown"; session: string | null };

export interface WahaWebhookPayload {
  event?: string;
  session?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function waIdToPhone(from: string): string {
  return from.replace(/@.*$/, "");
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  return typeof payload[key] === "string" ? (payload[key] as string) : null;
}

function extractText(payload: Record<string, unknown>): string | null {
  const direct = stringField(payload, "body");
  if (direct) return direct;
  const nested = payload.body as { text?: unknown } | undefined;
  return nested && typeof nested.text === "string" ? nested.text : null;
}

function normalizeMessageEvent(
  session: string,
  payload: Record<string, unknown>,
): NormalizedWahaEvent {
  const from = stringField(payload, "from") ?? "";
  return {
    type: "message",
    session,
    messageId: stringField(payload, "id"),
    from: waIdToPhone(from),
    text: extractText(payload),
    mediaUrl: stringField(payload, "mediaUrl"),
    fromMe: payload.fromMe === true,
  };
}

function normalizeSessionStatusEvent(
  session: string,
  body: WahaWebhookPayload,
  payload: Record<string, unknown>,
): NormalizedWahaEvent {
  const status =
    stringField(payload, "status") ??
    (typeof (body as { status?: unknown }).status === "string"
      ? String((body as { status?: unknown }).status)
      : "desconhecido");
  const me = payload.me as { id?: unknown } | undefined;
  const phone = me && typeof me.id === "string" ? waIdToPhone(me.id) : null;
  return { type: "session.status", session, status, phone };
}

/** Normaliza o envelope do WAHA (event/session/payload) em evento único. */
export function normalizeWahaEvent(body: WahaWebhookPayload): NormalizedWahaEvent {
  const event = typeof body.event === "string" ? body.event : "";
  const session = typeof body.session === "string" ? body.session : "";
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  if (event === "message" || event === "message.any") {
    return normalizeMessageEvent(session, payload);
  }
  if (event === "session.status") {
    return normalizeSessionStatusEvent(session, body, payload);
  }
  return { type: "unknown", session: session || null };
}
