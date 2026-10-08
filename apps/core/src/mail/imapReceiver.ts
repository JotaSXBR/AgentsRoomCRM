import type {
  IncomingMail,
  MailboxCredentials,
  MailReceiver,
} from "./transport.js";
import { parseRawEmail } from "./transport.js";

/**
 * Recebimento IMAP real (imapflow, import dinâmico). Estratégia: polling
 * (buscar UIDs maiores que o último visto); IDLE fica documentado como
 * evolução em `docs/f2b-meta-email.md`. Mensagens novas são marcadas como
 * lidas (`\Seen`) só depois de ingeridas pelo chamador? Não: o intake é
 * idempotente por Message-ID, então marcar como vista após a leitura é
 * seguro — reenvios caem como duplicata.
 */
function buildFetchRange(sinceUid: string | null): string {
  const since = sinceUid ? Number.parseInt(sinceUid, 10) : 0;
  return Number.isFinite(since) && since > 0 ? `${since + 1}:*` : "1:*";
}

function buildSeenRange(sinceUid: string | null): string {
  return sinceUid ? `${Number.parseInt(sinceUid, 10) + 1}:*` : "1:*";
}

interface ImapFetchMessage {
  uid?: unknown;
}

async function collectMails(
  client: { fetch: (range: string, opts: object) => AsyncIterable<unknown> },
  range: string,
  sinceUid: string | null,
): Promise<{ mails: Array<{ uid: string; raw: string }>; lastUid: string | null }> {
  const mails: Array<{ uid: string; raw: string }> = [];
  let maxUid = sinceUid;
  for await (const message of client.fetch(range, { uid: true, envelope: true, bodyParts: ["text"] })) {
    const uid = String((message as ImapFetchMessage).uid ?? "");
    if (maxUid === null || (uid !== "" && uid > maxUid)) maxUid = uid;
    mails.push({ uid, raw: messageToRaw(message) });
  }
  return { mails, lastUid: maxUid };
}

export function createImapReceiver(): MailReceiver {
  return {
    kind: "imap",
    async listNew(
      mbox: MailboxCredentials,
      sinceUid: string | null,
    ): Promise<{ mails: IncomingMail[]; lastUid: string | null }> {
      const { ImapFlow } = await import("imapflow");
      const client = new ImapFlow({
        host: mbox.imapHost,
        port: mbox.imapPort,
        secure: mbox.imapPort === 993,
        auth: { user: mbox.imapUser, pass: mbox.imapPass },
        logger: false,
      });
      await client.connect();
      try {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const range = buildFetchRange(sinceUid);
          const { mails: raws, lastUid } = await collectMails(client, range, sinceUid);
          const mails = raws.map(({ uid, raw }) => {
            const parsed = parseRawEmail(raw);
            return {
              ...parsed,
              messageId: parsed.messageId.startsWith("noid_")
                ? `uid_${uid || parsed.messageId}`
                : parsed.messageId,
            };
          });
          if (mails.length > 0) {
            await client.messageFlagsAdd(buildSeenRange(sinceUid), ["\\Seen"]).catch(() => undefined);
          }
          return { mails, lastUid };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}

interface ImapMessage {
  envelope?: {
    from?: Array<{ address?: string; name?: string }>;
    subject?: string;
    messageId?: string;
  };
  bodyParts?: Map<string, Buffer | string>;
}

function buildFromHeader(msg: ImapMessage): string {
  const from = msg.envelope?.from?.[0];
  if (!from) return "";
  return `${from.name ? `"${from.name}" ` : ""}<${from.address ?? ""}>`;
}

function extractBodyText(msg: ImapMessage): string {
  if (!msg.bodyParts) return "";
  let text = "";
  for (const part of msg.bodyParts.values()) {
    text += typeof part === "string" ? part : part.toString("utf8");
  }
  return text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageToRaw(message: any): string {
  const msg = message as ImapMessage;
  const headers = [
    `From: ${buildFromHeader(msg)}`,
    `Subject: ${msg.envelope?.subject ?? ""}`,
    `Message-ID: ${msg.envelope?.messageId ?? ""}`,
  ].join("\r\n");
  return `${headers}\r\n\r\n${extractBodyText(msg)}`;
}
