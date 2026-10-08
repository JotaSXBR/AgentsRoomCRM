import type {
  BotMenuOption,
  BotRuleKind,
  BotRuleRecord,
  BotSessionRecord,
  BotSessionState,
  BusinessHours,
  WorkspaceSettingsRecord,
} from "../store.js";
import { rowToWorkspaceSettings, rowToBotRule, rowToBotSession, type PostgresDeps } from "./rows.js";

export async function getWorkspaceSettings(deps: PostgresDeps, workspaceId: string): Promise<WorkspaceSettingsRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM workspace_settings WHERE workspace_id = $1",
        [workspaceId],
      );
      return rows[0] ? rowToWorkspaceSettings(rows[0]) : null;
    });
  }

export async function upsertWorkspaceSettings(deps: PostgresDeps, input: {
    workspaceId: string;
    timezone?: string;
    absenceMessage?: string;
    businessHours?: BusinessHours;
  }): Promise<WorkspaceSettingsRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO workspace_settings (workspace_id, timezone, absence_message, business_hours)
         VALUES ($1, COALESCE($2, 'America/Sao_Paulo'),
                 COALESCE($3, 'Olá! Estamos fora do horário de atendimento no momento. Deixe sua mensagem que retornaremos em breve.'),
                 COALESCE($4::jsonb, '{}'::jsonb))
         ON CONFLICT (workspace_id) DO UPDATE SET
           timezone = COALESCE($2, workspace_settings.timezone),
           absence_message = COALESCE($3, workspace_settings.absence_message),
           business_hours = COALESCE($4::jsonb, workspace_settings.business_hours),
           updated_at = NOW()
         RETURNING *`,
        [input.workspaceId, input.timezone ?? null, input.absenceMessage ?? null, input.businessHours ? JSON.stringify(input.businessHours) : null],
      );
      return rowToWorkspaceSettings(rows[0]);
    });
  }

export async function createBotRule(deps: PostgresDeps, input: {
    workspaceId: string;
    name: string;
    kind: BotRuleKind;
    priority?: number;
    active?: boolean;
    terms?: string[];
    reply?: string | null;
    options?: BotMenuOption[];
    queueId?: string | null;
  }): Promise<BotRuleRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bot_rules (workspace_id, name, kind, priority, active, terms, reply, options, queue_id)
         VALUES ($1, $2, $3, COALESCE($4, 100), COALESCE($5, TRUE), $6::jsonb, $7, $8::jsonb, $9)
         RETURNING *`,
        [
          input.workspaceId,
          input.name,
          input.kind,
          input.priority ?? null,
          input.active ?? null,
          JSON.stringify(input.terms ?? []),
          input.reply ?? null,
          JSON.stringify(input.options ?? []),
          input.queueId ?? null,
        ],
      );
      return rowToBotRule(rows[0]);
    });
  }

export async function listBotRules(deps: PostgresDeps, workspaceId: string): Promise<BotRuleRecord[]> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM bot_rules WHERE workspace_id = $1 ORDER BY priority, created_at",
        [workspaceId],
      );
      return rows.map(rowToBotRule);
    });
  }

export async function updateBotRule(deps: PostgresDeps, 
    workspaceId: string,
    id: string,
    patch: Partial<{
      name: string;
      priority: number;
      active: boolean;
      terms: string[];
      reply: string | null;
      options: BotMenuOption[];
      queueId: string | null;
    }>,
  ): Promise<BotRuleRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        `UPDATE bot_rules SET
           name = COALESCE($3, name),
           priority = COALESCE($4, priority),
           active = COALESCE($5, active),
           terms = COALESCE($6::jsonb, terms),
           reply = CASE WHEN $7::boolean THEN $8 ELSE reply END,
           options = COALESCE($9::jsonb, options),
           queue_id = CASE WHEN $10::boolean THEN $11 ELSE queue_id END,
           updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [
          id,
          workspaceId,
          patch.name ?? null,
          patch.priority ?? null,
          patch.active ?? null,
          patch.terms ? JSON.stringify(patch.terms) : null,
          patch.reply !== undefined,
          patch.reply ?? null,
          patch.options ? JSON.stringify(patch.options) : null,
          patch.queueId !== undefined,
          patch.queueId ?? null,
        ],
      );
      return rows[0] ? rowToBotRule(rows[0]) : null;
    });
  }

export async function deleteBotRule(deps: PostgresDeps, workspaceId: string, id: string): Promise<boolean> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rowCount } = await client.query(
        "DELETE FROM bot_rules WHERE id = $1 AND workspace_id = $2",
        [id, workspaceId],
      );
      return (rowCount ?? 0) > 0;
    });
  }

export async function getBotSession(deps: PostgresDeps, workspaceId: string, conversationId: string): Promise<BotSessionRecord | null> {
    return deps.withWorkspace(workspaceId, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM bot_sessions WHERE workspace_id = $1 AND conversation_id = $2",
        [workspaceId, conversationId],
      );
      return rows[0] ? rowToBotSession(rows[0]) : null;
    });
  }

export async function setBotSession(deps: PostgresDeps, input: {
    workspaceId: string;
    conversationId: string;
    state: BotSessionState;
  }): Promise<BotSessionRecord> {
    return deps.withWorkspace(input.workspaceId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bot_sessions (conversation_id, workspace_id, state)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (conversation_id) DO UPDATE SET state = $3::jsonb, updated_at = NOW()
         RETURNING *`,
        [input.conversationId, input.workspaceId, JSON.stringify(input.state)],
      );
      return rowToBotSession(rows[0]);
    });
  }
