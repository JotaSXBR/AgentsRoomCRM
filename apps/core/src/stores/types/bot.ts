// ---- F3: bot por regras, filas/distribuição, SLA básico ----

/** Faixas de atendimento por dia da semana: chave "0".."6" (getDay), faixas ["HH:MM","HH:MM"]. */
export type BusinessHours = Record<string, Array<[string, string]> | null>;

export interface WorkspaceSettingsRecord {
  workspaceId: string;
  timezone: string;
  absenceMessage: string;
  businessHours: BusinessHours;
  updatedAt: string;
}

export type BotRuleKind = "palavra_chave" | "menu" | "triagem";

export interface BotMenuOption {
  key: string;
  label: string;
  reply: string;
  queueId: string | null;
}

export interface BotRuleRecord {
  id: string;
  workspaceId: string;
  name: string;
  kind: BotRuleKind;
  priority: number;
  active: boolean;
  terms: string[];
  reply: string | null;
  options: BotMenuOption[];
  queueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotSessionState {
  menuRuleId?: string;
  lastAbsenceAt?: string;
  [extra: string]: unknown;
}

export interface BotSessionRecord {
  conversationId: string;
  workspaceId: string;
  state: BotSessionState;
  updatedAt: string;
}

export interface WorkspaceSettingsStore {
  // ---- F3: settings por workspace ----
  getWorkspaceSettings(
    workspaceId: string,
  ): Promise<WorkspaceSettingsRecord | null>;
  upsertWorkspaceSettings(input: {
    workspaceId: string;
    timezone?: string;
    absenceMessage?: string;
    businessHours?: BusinessHours;
  }): Promise<WorkspaceSettingsRecord>;
}

export interface BotStore {
  // ---- F3: bot ----
  createBotRule(input: {
    workspaceId: string;
    name: string;
    kind: BotRuleKind;
    priority?: number;
    active?: boolean;
    terms?: string[];
    reply?: string | null;
    options?: BotMenuOption[];
    queueId?: string | null;
  }): Promise<BotRuleRecord>;
  listBotRules(workspaceId: string): Promise<BotRuleRecord[]>;
  updateBotRule(
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
  ): Promise<BotRuleRecord | null>;
  deleteBotRule(workspaceId: string, id: string): Promise<boolean>;
  getBotSession(
    workspaceId: string,
    conversationId: string,
  ): Promise<BotSessionRecord | null>;
  setBotSession(input: {
    workspaceId: string;
    conversationId: string;
    state: BotSessionState;
  }): Promise<BotSessionRecord>;
}
