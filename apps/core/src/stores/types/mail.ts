/** Mailbox por workspace: SMTP (envio) + IMAP (recebimento). */
export interface MailboxRecord {
  id: string;
  workspaceId: string;
  name: string;
  fromEmail: string;
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** Senha SMTP CIFRADA — nunca exposta na API. */
  smtpPassEnc: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  /** Senha IMAP CIFRADA — nunca exposta na API. */
  imapPassEnc: string;
  lastUid: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxesStore {
  // mailboxes (SMTP + IMAP por workspace)
  createMailbox(input: {
    workspaceId: string;
    name: string;
    fromEmail: string;
    fromName?: string | null;
    smtpHost: string;
    smtpPort?: number;
    smtpUser: string;
    smtpPassEnc: string;
    imapHost: string;
    imapPort?: number;
    imapUser: string;
    imapPassEnc: string;
  }): Promise<MailboxRecord>;
  listMailboxes(workspaceId: string): Promise<MailboxRecord[]>;
  findMailboxById(workspaceId: string, id: string): Promise<MailboxRecord | null>;
  updateMailbox(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      fromName?: string | null;
      status?: string;
      lastUid?: string | null;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassEnc?: string;
      imapHost?: string;
      imapPort?: number;
      imapUser?: string;
      imapPassEnc?: string;
    },
  ): Promise<MailboxRecord | null>;
  deleteMailbox(workspaceId: string, id: string): Promise<boolean>;
}
