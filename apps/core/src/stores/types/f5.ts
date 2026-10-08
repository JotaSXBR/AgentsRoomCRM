// ---- F5: API pública, webhooks de saída, fluxos, CSAT e LGPD ----

export type ApiKeyScope = "mcp" | "api:leitura" | "api:escrita";

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  /** `ark_live_a1b2c3` — metade pública, exibida na UI. */
  prefix: string;
  /** SHA-256 do segredo completo; o segredo em si nunca é persistido. */
  keyHash: string;
  scopes: ApiKeyScope[];
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface WebhookEndpointRecord {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  /** Segredo HMAC — guardado para assinar, devolvido só na criação. */
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WebhookDeliveryStatus = "pendente" | "entregue" | "falhou";

export interface WebhookDeliveryRecord {
  id: string;
  workspaceId: string;
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RatingSource = "atendente" | "cliente";

export interface ConversationRatingRecord {
  id: string;
  workspaceId: string;
  conversationId: string;
  /** 1..5 (CSAT). */
  score: number;
  comment: string | null;
  source: RatingSource;
  ratedBy: string | null;
  createdAt: string;
}

export type ConsentKind = "dados" | "marketing" | "ia";

export interface ContactConsentRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  kind: ConsentKind;
  granted: boolean;
  source: string;
  note: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LgpdRequestRecord {
  id: string;
  workspaceId: string;
  /** NULL = operação sobre o workspace inteiro. */
  contactId: string | null;
  scope: "contato" | "workspace";
  action: "acesso" | "exclusao";
  status: "concluido" | "parcial";
  summary: Record<string, unknown>;
  requestedBy: string | null;
  createdAt: string;
}

export type FlowAction = "responder" | "menu" | "enfileirar" | "encerrar";

export interface FlowStepRecord {
  id: string;
  workspaceId: string;
  flowId: string;
  position: number;
  action: FlowAction;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FlowRecord {
  id: string;
  workspaceId: string;
  name: string;
  /** Termos que disparam o fluxo (casamento por substring, como as regras do bot). */
  terms: string[];
  active: boolean;
  steps: FlowStepRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceModuleRecord {
  workspaceId: string;
  moduleKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface ApiKeysStore {
  createApiKey(input: {
    workspaceId: string;
    name: string;
    prefix: string;
    keyHash: string;
    scopes?: ApiKeyScope[];
    createdBy?: string | null;
  }): Promise<ApiKeyRecord>;
  listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  touchApiKey(workspaceId: string, id: string): Promise<ApiKeyRecord | null>;
  revokeApiKey(workspaceId: string, id: string): Promise<boolean>;
}

export interface WebhooksStore {
  createWebhookEndpoint(input: {
    workspaceId: string;
    name: string;
    url: string;
    secret: string;
    events?: string[];
  }): Promise<WebhookEndpointRecord>;
  listWebhookEndpoints(workspaceId: string): Promise<WebhookEndpointRecord[]>;
  findWebhookEndpoint(
    workspaceId: string,
    id: string,
  ): Promise<WebhookEndpointRecord | null>;
  deleteWebhookEndpoint(workspaceId: string, id: string): Promise<boolean>;
  enqueueWebhookDelivery(input: {
    workspaceId: string;
    endpointId: string;
    event: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: string;
  }): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(
    workspaceId: string,
    filter?: { endpointId?: string; status?: WebhookDeliveryStatus },
  ): Promise<WebhookDeliveryRecord[]>;
  markWebhookDelivery(
    workspaceId: string,
    id: string,
    patch: {
      status?: WebhookDeliveryStatus;
      attempts?: number;
      nextAttemptAt?: string;
      responseCode?: number | null;
      lastError?: string | null;
    },
  ): Promise<WebhookDeliveryRecord | null>;
}

export interface RatingsStore {
  /** Um registro por conversa: repetir sobrescreve (idempotente). */
  rateConversation(input: {
    workspaceId: string;
    conversationId: string;
    score: number;
    comment?: string | null;
    source?: RatingSource;
    ratedBy?: string | null;
  }): Promise<ConversationRatingRecord>;
  findRating(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationRatingRecord | null>;
  listRatings(
    workspaceId: string,
    options?: { conversationIds?: string[] },
  ): Promise<ConversationRatingRecord[]>;
}

export interface ConsentsStore {
  setConsent(input: {
    workspaceId: string;
    contactId: string;
    kind: ConsentKind;
    granted: boolean;
    source?: string;
    note?: string | null;
  }): Promise<ContactConsentRecord>;
  listConsents(
    workspaceId: string,
    filter?: { contactId?: string; kind?: ConsentKind },
  ): Promise<ContactConsentRecord[]>;
}

export interface LgpdStore {
  addLgpdRequest(input: {
    workspaceId: string;
    contactId?: string | null;
    scope: "contato" | "workspace";
    action: "acesso" | "exclusao";
    status?: "concluido" | "parcial";
    summary: Record<string, unknown>;
    requestedBy?: string | null;
  }): Promise<LgpdRequestRecord>;
  listLgpdRequests(workspaceId: string): Promise<LgpdRequestRecord[]>;
  /** Apaga os dados pessoais de um contato (anonimiza o cadastro, zera conteúdo). */
  purgeContactData(workspaceId: string, contactId: string): Promise<Record<string, number>>;
  /** Apaga os dados pessoais de todos os contatos do workspace. */
  purgeWorkspaceContacts(workspaceId: string): Promise<Record<string, number>>;
}

export interface FlowsStore {
  createFlow(input: {
    workspaceId: string;
    name: string;
    terms?: string[];
    active?: boolean;
    steps: Array<{ action: FlowAction; payload: Record<string, unknown> }>;
  }): Promise<FlowRecord>;
  listFlows(workspaceId: string): Promise<FlowRecord[]>;
  findFlowById(workspaceId: string, id: string): Promise<FlowRecord | null>;
  setFlowActive(
    workspaceId: string,
    id: string,
    active: boolean,
  ): Promise<FlowRecord | null>;
  deleteFlow(workspaceId: string, id: string): Promise<boolean>;
}

export interface ModulesStore {
  listWorkspaceModules(workspaceId: string): Promise<WorkspaceModuleRecord[]>;
  setWorkspaceModule(input: {
    workspaceId: string;
    moduleKey: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }): Promise<WorkspaceModuleRecord>;
}