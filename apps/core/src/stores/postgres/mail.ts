import type {
  MailboxRecord,
} from "../store.js";
import { rowToMailbox, mailboxPatchParams, type PostgresDeps } from "./rows.js";

export async function createMailbox(deps: PostgresDeps, input: {
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
  }): Promise<MailboxRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO mailboxes
           (workspace_id, name, from_email, from_name, smtp_host, smtp_port, smtp_user, smtp_pass_enc,
            imap_host, imap_port, imap_user, imap_pass_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          input.workspaceId,
          input.name,
          input.fromEmail.toLowerCase(),
          input.fromName ?? null,
          input.smtpHost,
          input.smtpPort ?? 587,
          input.smtpUser,
          input.smtpPassEnc,
          input.imapHost,
          input.imapPort ?? 993,
          input.imapUser,
          input.imapPassEnc,
        ],
      );
      return rowToMailbox(rows[0]);
    });
  }

export async function listMailboxes(deps: PostgresDeps, workspaceId: string): Promise<MailboxRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM mailboxes WHERE workspace_id = $1 ORDER BY created_at",
        [workspaceId],
      );
      return rows.map(rowToMailbox);
    });
  }

export async function findMailboxById(deps: PostgresDeps, workspaceId: string, id: string): Promise<MailboxRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM mailboxes WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return rows[0] ? rowToMailbox(rows[0]) : null;
    });
  }

export async function updateMailbox(deps: PostgresDeps, 
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
  ): Promise<MailboxRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE mailboxes SET
           name = COALESCE($3, name),
           from_name = CASE WHEN $4::boolean THEN $5 ELSE from_name END,
           status = COALESCE($6, status),
           last_uid = CASE WHEN $7::boolean THEN $8 ELSE last_uid END,
           smtp_host = COALESCE($9, smtp_host),
           smtp_port = COALESCE($10, smtp_port),
           smtp_user = COALESCE($11, smtp_user),
           smtp_pass_enc = COALESCE($12, smtp_pass_enc),
           imap_host = COALESCE($13, imap_host),
           imap_port = COALESCE($14, imap_port),
           imap_user = COALESCE($15, imap_user),
           imap_pass_enc = COALESCE($16, imap_pass_enc),
           updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        mailboxPatchParams(id, workspaceId, patch),
      );
      return rows[0] ? rowToMailbox(rows[0]) : null;
    });
  }

export async function deleteMailbox(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "DELETE FROM mailboxes WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }
