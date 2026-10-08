import type {
  ConsentKind,
  ContactConsentRecord,
  ConversationRatingRecord,
  LgpdRequestRecord,
  RatingSource,
} from "../store.js";
import type { PostgresDeps } from "./rows.js";
import type { PoolClient } from "pg";
import { rowToConsent, rowToLgpdRequest, rowToRating } from "./rowsF5.js";

/** Tabelas varridas na limpeza LGPD e a chave do contador correspondente. */
const CONVERSATION_TABLES = {
  messages: "mensagens_removidas",
  notes: "notas_removidas",
  queue_tickets: "tickets_removidos",
  conversation_ratings: "avaliacoes_removidas",
} as const;
const CONTACT_TABLES = {
  contact_channels: "canais_removidos",
  contact_events: "eventos_removidos",
} as const;

/** Alvo da contagem de linhas na limpeza LGPD (objeto único para caber no orçamento de parâmetros). */
interface CountTarget {
  table: string;
  column: string;
  workspaceId: string;
  ids: string[];
}

async function countRows(
  client: PoolClient,
  target: CountTarget,
): Promise<number> {
  const { table, column, workspaceId, ids } = target;  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE workspace_id = $1 AND ${column} = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countContactRows(
  client: PoolClient,
  table: string,
  workspaceId: string,
  contactId: string,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE workspace_id = $1 AND contact_id = $2`,
    [workspaceId, contactId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Apaga o conteúdo pessoal de um contato e anonimiza o cadastro. Uma transação
 * só: ou o titular fica sem rastro, ou nada muda.
 */
async function purgeOne(
  client: PoolClient,
  workspaceId: string,
  contactId: string,
): Promise<Record<string, number>> {
  const { rows: conv } = await client.query(
    "SELECT id FROM conversations WHERE workspace_id = $1 AND contact_id = $2",
    [workspaceId, contactId],
  );
  const conversationIds = conv.map((c) => String(c.id));
  const counters: Record<string, number> = { conversas_removidas: conversationIds.length };
  for (const [table, counter] of Object.entries(CONVERSATION_TABLES)) {
    counters[counter] = await countRows(client, { table, column: "conversation_id", workspaceId, ids: conversationIds });
  }
  for (const [table, counter] of Object.entries(CONTACT_TABLES)) {
    counters[counter] = await countContactRows(client, table, workspaceId, contactId);
  }
  await client.query("DELETE FROM conversation_tags WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
  await client.query("DELETE FROM bot_sessions WHERE conversation_id = ANY($1::uuid[])", [conversationIds]);
  await client.query("DELETE FROM contact_consents WHERE contact_id = $1", [contactId]);
  for (const table of Object.keys(CONVERSATION_TABLES)) {
    await client.query(`DELETE FROM ${table} WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
  }
  await client.query("DELETE FROM conversations WHERE id = ANY($1::uuid[])", [conversationIds]);
  for (const table of Object.keys(CONTACT_TABLES)) {
    await client.query(`DELETE FROM ${table} WHERE contact_id = $1`, [contactId]);
  }
  await client.query(
    `UPDATE contacts SET name = 'Contato eliminado (LGPD)', phone = NULL, email = NULL WHERE id = $1`,
    [contactId],
  );
  return counters;
}

export async function purgeContactData(deps: PostgresDeps, workspaceId: string, contactId: string): Promise<Record<string, number>> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT 1 FROM contacts WHERE id = $1 AND workspace_id = $2",
      [contactId, workspaceId],
    );
    if (rows.length === 0) throw new Error("contato_invalido");
    return purgeOne(client, workspaceId, contactId);
  });
}

export async function purgeWorkspaceContacts(deps: PostgresDeps, workspaceId: string): Promise<Record<string, number>> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM contacts WHERE workspace_id = $1",
      [workspaceId],
    );
    const totals: Record<string, number> = { contatos_anonimizados: rows.length };
    for (const row of rows) {
      const counters = await purgeOne(client, workspaceId, String(row.id));
      for (const [key, value] of Object.entries(counters)) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
    return totals;
  });
}

// ------------------------------------------------------------ CSAT ---

export async function rateConversation(deps: PostgresDeps, input: {
    workspaceId: string;
    conversationId: string;
    score: number;
    comment?: string | null;
    source?: RatingSource;
    ratedBy?: string | null;
  }): Promise<ConversationRatingRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows: exists } = await client.query(
      "SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2",
      [input.conversationId, input.workspaceId],
    );
    if (exists.length === 0) throw new Error("conversa_invalida");
    const { rows } = await client.query(
      `INSERT INTO conversation_ratings (workspace_id, conversation_id, score, comment, source, rated_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'atendente'), $6)
       ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET
         score = EXCLUDED.score, comment = EXCLUDED.comment,
         source = EXCLUDED.source, rated_by = EXCLUDED.rated_by, created_at = NOW()
       RETURNING *`,
      [input.workspaceId, input.conversationId, input.score, input.comment ?? null,
        input.source ?? null, input.ratedBy ?? null],
    );
    return rowToRating(rows[0]);
  });
}

export async function findRating(deps: PostgresDeps, workspaceId: string, conversationId: string): Promise<ConversationRatingRecord | null> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM conversation_ratings WHERE workspace_id = $1 AND conversation_id = $2",
      [workspaceId, conversationId],
    );
    return rows[0] ? rowToRating(rows[0]) : null;
  });
}

export async function listRatings(deps: PostgresDeps, workspaceId: string,
    options?: { conversationIds?: string[] },
  ): Promise<ConversationRatingRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM conversation_ratings
       WHERE workspace_id = $1
         AND (COALESCE($2::uuid[], '{}') = '{}' OR conversation_id = ANY($2::uuid[]))
       ORDER BY created_at`,
      [workspaceId, options?.conversationIds ?? []],
    );
    return rows.map(rowToRating);
  });
}

// --------------------------------------------------------- consentimento ---

export async function setConsent(deps: PostgresDeps, input: {
    workspaceId: string;
    contactId: string;
    kind: ConsentKind;
    granted: boolean;
    source?: string;
    note?: string | null;
  }): Promise<ContactConsentRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows: contact } = await client.query(
      "SELECT 1 FROM contacts WHERE id = $1 AND workspace_id = $2",
      [input.contactId, input.workspaceId],
    );
    if (contact.length === 0) throw new Error("contato_invalido");
    const { rows } = await client.query(
      `INSERT INTO contact_consents (workspace_id, contact_id, kind, granted, source, note, granted_at, revoked_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'manual'), $6,
               CASE WHEN $4 THEN NOW() ELSE NULL END,
               CASE WHEN $4 THEN NULL ELSE NOW() END)
       ON CONFLICT (workspace_id, contact_id, kind) DO UPDATE SET
         granted = EXCLUDED.granted,
         source = COALESCE($5, contact_consents.source),
         note = COALESCE($6, contact_consents.note),
         granted_at = CASE WHEN EXCLUDED.granted THEN NOW() ELSE contact_consents.granted_at END,
         revoked_at = CASE WHEN EXCLUDED.granted THEN NULL ELSE NOW() END,
         updated_at = NOW()
       RETURNING *`,
      [input.workspaceId, input.contactId, input.kind, input.granted,
        input.source ?? null, input.note ?? null],
    );
    return rowToConsent(rows[0]);
  });
}

export async function listConsents(deps: PostgresDeps, workspaceId: string,
    filter?: { contactId?: string; kind?: ConsentKind },
  ): Promise<ContactConsentRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const clauses = ["workspace_id = $1"];
    const params: unknown[] = [workspaceId];
    if (filter?.contactId) { params.push(filter.contactId); clauses.push(`contact_id = $${params.length}`); }
    if (filter?.kind) { params.push(filter.kind); clauses.push(`kind = $${params.length}`); }
    const { rows } = await client.query(
      `SELECT * FROM contact_consents WHERE ${clauses.join(" AND ")} ORDER BY created_at`,
      params,
    );
    return rows.map(rowToConsent);
  });
}

export async function addLgpdRequest(deps: PostgresDeps, input: {
    workspaceId: string;
    contactId?: string | null;
    scope: "contato" | "workspace";
    action: "acesso" | "exclusao";
    status?: "concluido" | "parcial";
    summary: Record<string, unknown>;
    requestedBy?: string | null;
  }): Promise<LgpdRequestRecord> {
  return deps.withWorkspace(input.workspaceId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO lgpd_requests (workspace_id, contact_id, scope, action, status, summary, requested_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'concluido'), $6::jsonb, $7) RETURNING *`,
      [input.workspaceId, input.contactId ?? null, input.scope, input.action,
        input.status ?? null, JSON.stringify(input.summary), input.requestedBy ?? null],
    );
    return rowToLgpdRequest(rows[0]);
  });
}

export async function listLgpdRequests(deps: PostgresDeps, workspaceId: string): Promise<LgpdRequestRecord[]> {
  return deps.withWorkspace(workspaceId, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM lgpd_requests WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200",
      [workspaceId],
    );
    return rows.map(rowToLgpdRequest);
  });
}