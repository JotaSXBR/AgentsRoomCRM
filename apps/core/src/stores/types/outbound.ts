export type OutboundStatus = "pendente" | "enviado" | "falhou";

/** Item da fila de saída (Meta/e-mail) com backoff. */
export interface OutboundRecord {
  id: string;
  workspaceId: string;
  /** "messenger" | "instagram" | "email". */
  channel: string;
  conversationId: string | null;
  messageId: string | null;
  mailboxId: string | null;
  toValue: string;
  subject: string | null;
  text: string | null;
  status: OutboundStatus | string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundStore {
  // fila de saída com backoff
  enqueueOutbound(input: {
    workspaceId: string;
    channel: string;
    conversationId?: string | null;
    messageId?: string | null;
    mailboxId?: string | null;
    toValue: string;
    subject?: string | null;
    text?: string | null;
  }): Promise<OutboundRecord>;
  listOutboundDue(
    workspaceId: string,
    nowIso: string,
    limit?: number,
  ): Promise<OutboundRecord[]>;
  listOutbound(
    workspaceId: string,
    filter?: { status?: string },
  ): Promise<OutboundRecord[]>;
  markOutboundSent(
    workspaceId: string,
    id: string,
    providerMessageId: string | null,
  ): Promise<OutboundRecord | null>;
  markOutboundRetry(
    workspaceId: string,
    id: string,
    nextAttemptIso: string,
    error: string,
  ): Promise<OutboundRecord | null>;
  markOutboundFailed(
    workspaceId: string,
    id: string,
    error: string,
  ): Promise<OutboundRecord | null>;
}
