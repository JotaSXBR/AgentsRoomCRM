/**
 * Portas de e-mail por mailbox (F2b). O core só conhece estas interfaces:
 * envio via `MailSender`, recebimento via `MailReceiver`.
 * Implementações reais (SMTP/IMAP) em `smtpSender.ts` / `imapReceiver.ts`,
 * carregadas sob demanda para os testes nunca tocarem em rede.
 */

export interface MailboxCredentials {
  fromEmail: string;
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface IncomingMail {
  /** Message-ID (ou UID) para idempotência — nunca nulo no intake. */
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  text: string | null;
}

export interface MailSender {
  readonly kind: string;
  send(mbox: MailboxCredentials, mail: OutgoingMail): Promise<{ externalId: string }>;
}

export interface MailReceiver {
  readonly kind: string;
  /**
   * Lista mensagens novas desde `sinceUid` (UID do IMAP como string opaca).
   * Devolve também o `lastUid` para persistir no mailbox.
   */
  listNew(
    mbox: MailboxCredentials,
    sinceUid: string | null,
  ): Promise<{ mails: IncomingMail[]; lastUid: string | null }>;
}

function headerValue(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function extractEmailAddress(from: string): string {
  const angle = from.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (angle) return angle[1].toLowerCase();
  const plain = from.match(/([^\s<>]+@[^\s<>]+)/);
  return (plain ? plain[1] : from).trim().toLowerCase();
}

function extractDisplayName(from: string): string | null {
  const quoted = from.match(/^\s*"([^"]+)"\s*</);
  if (quoted) return quoted[1].trim();
  const bare = from.match(/^\s*([^<"]+?)\s*</);
  if (bare && bare[1].trim() !== "") return bare[1].trim();
  return null;
}

/**
 * Parser mínimo de RFC 822 (texto puro). Suficiente para o intake via IMAP;
 * anexos/HTML multipart viram texto corrido — limitação documentada em
 * `docs/f2b-meta-email.md`.
 */
export function parseRawEmail(raw: string): IncomingMail {
  const headEnd = raw.search(/\r?\n\r?\n/);
  const head = headEnd >= 0 ? raw.slice(0, headEnd) : raw;
  const body = headEnd >= 0 ? raw.slice(headEnd).replace(/^\r?\n\r?\n/, "") : "";
  const from = headerValue(head, "From") ?? "";
  const messageId =
    headerValue(head, "Message-ID")?.replace(/^<|>$/g, "") ??
    `noid_${Date.now().toString(36)}`;
  return {
    messageId,
    fromEmail: extractEmailAddress(from),
    fromName: extractDisplayName(from),
    subject: headerValue(head, "Subject"),
    text: body.trim() === "" ? null : body.trim().slice(0, 20_000),
  };
}
