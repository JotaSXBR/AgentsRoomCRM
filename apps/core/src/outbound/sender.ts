import { decryptSecret } from "../lib/secrets.js";
import type { MailSender } from "../mail/transport.js";
import type { MetaAdapter } from "../meta/adapter.js";
import type { Store } from "../stores/store.js";
import type { OutboundSender } from "./queue.js";

/**
 * Monta o `OutboundSender` de um workspace: resolve conexão Meta / mailbox,
 * decifra os segredos em memória (nunca logados) e delega aos adapters.
 * Devolve null quando o workspace não tem nada configurado.
 */
export function buildWorkspaceSender(options: {
  store: Store;
  workspaceId: string;
  metaAdapter: MetaAdapter | null;
  mailSender: MailSender | null;
  secretsKey: string;
}): OutboundSender {
  const { store, workspaceId, metaAdapter, mailSender, secretsKey } = options;

  return {
    async sendMeta(input: {
      channel: string;
      toValue: string;
      text: string | null;
    }): Promise<{ externalId: string }> {
      if (!metaAdapter) throw new Error("meta_nao_configurada");
      if (input.channel !== "messenger" && input.channel !== "instagram") {
        throw new Error(`canal_meta_invalido: ${input.channel}`);
      }
      if (!input.text) throw new Error("mensagem_vazia");
      const connection = await store.getMetaConnection(workspaceId);
      if (!connection) throw new Error("meta_desconectada");
      const pageAccessToken = decryptSecret(connection.accessTokenEnc, secretsKey);
      return metaAdapter.sendText({
        channel: input.channel,
        pageAccessToken,
        recipientId: input.toValue,
        text: input.text,
      });
    },

    async sendMail(input: {
      mailboxId: string | null;
      toValue: string;
      subject: string | null;
      text: string | null;
    }): Promise<{ externalId: string }> {
      if (!mailSender) throw new Error("smtp_nao_configurado");
      if (!input.mailboxId) throw new Error("mailbox_ausente");
      if (!input.text) throw new Error("mensagem_vazia");
      const mailbox = await store.findMailboxById(workspaceId, input.mailboxId);
      if (!mailbox) throw new Error("mailbox_nao_encontrada");
      if (mailbox.status !== "ativa") throw new Error("mailbox_inativa");
      return mailSender.send(
        {
          fromEmail: mailbox.fromEmail,
          fromName: mailbox.fromName,
          smtpHost: mailbox.smtpHost,
          smtpPort: mailbox.smtpPort,
          smtpUser: mailbox.smtpUser,
          smtpPass: decryptSecret(mailbox.smtpPassEnc, secretsKey),
          imapHost: mailbox.imapHost,
          imapPort: mailbox.imapPort,
          imapUser: mailbox.imapUser,
          imapPass: decryptSecret(mailbox.imapPassEnc, secretsKey),
        },
        {
          to: input.toValue,
          subject: input.subject ?? "(sem assunto)",
          text: input.text,
        },
      );
    },
  };
}
