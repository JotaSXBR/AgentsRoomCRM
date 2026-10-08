import type {
  MailboxCredentials,
  MailSender,
  OutgoingMail,
} from "./transport.js";

/**
 * Envio SMTP real (nodemailer, import dinâmico para não pesar nos testes).
 * Uma conexão por envio — simples e suficiente para o volume do CRM;
 * a fila com backoff (`src/outbound/`) absorve falhas transitórias.
 */
export function createSmtpSender(): MailSender {
  return {
    kind: "smtp",
    async send(
      mbox: MailboxCredentials,
      mail: OutgoingMail,
    ): Promise<{ externalId: string }> {
      const { default: nodemailer } = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: mbox.smtpHost,
        port: mbox.smtpPort,
        secure: mbox.smtpPort === 465,
        auth: { user: mbox.smtpUser, pass: mbox.smtpPass },
      });
      try {
        const info = await transporter.sendMail({
          from: mbox.fromName
            ? `"${mbox.fromName}" <${mbox.fromEmail}>`
            : mbox.fromEmail,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        });
        const externalId =
          typeof info.messageId === "string" && info.messageId !== ""
            ? info.messageId
            : `smtp_${Date.now().toString(36)}`;
        return { externalId };
      } finally {
        transporter.close();
      }
    },
  };
}
