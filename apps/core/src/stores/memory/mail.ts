import { randomUUID } from "node:crypto";
import type { MailboxRecord } from "../types/mail.js";
import type { MemoryState } from "./shared.js";
import { now, pick } from "./shared.js";

export type MailState = Pick<MemoryState, "mailboxes">;

export interface MailboxPatch {
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
}

export async function createMailbox(
  state: MailState,
  input: {
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
  },
): Promise<MailboxRecord> {
  const record: MailboxRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    fromEmail: input.fromEmail.toLowerCase(),
    fromName: input.fromName ?? null,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort ?? 587,
    smtpUser: input.smtpUser,
    smtpPassEnc: input.smtpPassEnc,
    imapHost: input.imapHost,
    imapPort: input.imapPort ?? 993,
    imapUser: input.imapUser,
    imapPassEnc: input.imapPassEnc,
    lastUid: null,
    status: "ativa",
    createdAt: now(),
    updatedAt: now(),
  };
  state.mailboxes.set(record.id, record);
  return record;
}

export async function listMailboxes(
  state: MailState,
  workspaceId: string,
): Promise<MailboxRecord[]> {
  return [...state.mailboxes.values()]
    .filter((m) => m.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findMailboxById(
  state: MailState,
  workspaceId: string,
  id: string,
): Promise<MailboxRecord | null> {
  const m = state.mailboxes.get(id);
  return m && m.workspaceId === workspaceId ? m : null;
}

function applyMailboxPatch(m: MailboxRecord, patch: MailboxPatch): MailboxRecord {
  return {
    ...m,
    name: pick(patch.name, m.name, m.name),
    fromName: patch.fromName !== undefined ? patch.fromName : m.fromName,
    status: pick(patch.status, m.status, m.status),
    lastUid: patch.lastUid !== undefined ? patch.lastUid : m.lastUid,
    smtpHost: pick(patch.smtpHost, m.smtpHost, m.smtpHost),
    smtpPort: pick(patch.smtpPort, m.smtpPort, m.smtpPort),
    smtpUser: pick(patch.smtpUser, m.smtpUser, m.smtpUser),
    smtpPassEnc: pick(patch.smtpPassEnc, m.smtpPassEnc, m.smtpPassEnc),
    imapHost: pick(patch.imapHost, m.imapHost, m.imapHost),
    imapPort: pick(patch.imapPort, m.imapPort, m.imapPort),
    imapUser: pick(patch.imapUser, m.imapUser, m.imapUser),
    imapPassEnc: pick(patch.imapPassEnc, m.imapPassEnc, m.imapPassEnc),
    updatedAt: now(),
  };
}

export async function updateMailbox(
  state: MailState,
  workspaceId: string,
  id: string,
  patch: MailboxPatch,
): Promise<MailboxRecord | null> {
  const m = state.mailboxes.get(id);
  if (!m || m.workspaceId !== workspaceId) return null;
  const updated = applyMailboxPatch(m, patch);
  state.mailboxes.set(id, updated);
  return updated;
}

export async function deleteMailbox(
  state: MailState,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const m = state.mailboxes.get(id);
  if (!m || m.workspaceId !== workspaceId) return false;
  state.mailboxes.delete(id);
  return true;
}
