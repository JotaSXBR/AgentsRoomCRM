import type {
  ApiKeyScope,
  ConsentKind,
  FlowAction,
  RatingSource,
  WebhookDeliveryStatus,
} from "../store.js";
import type { MemoryState } from "./shared.js";
import * as f5keys from "./f5keys.js";
import * as f5lgpd from "./f5lgpd.js";
import * as f5flows from "./f5flows.js";

/**
 * Superclasse com as operações da F5 (API pública, webhooks, CSAT, LGPD,
 * fluxos e módulos) do `MemoryStore`.
 *
 * `MemoryStore` estende esta classe em vez de declarar os 29 métodos: fica com
 * o tamanho original e os métodos continuam no prototype (instanciável,
 * inspecionável e com `this` correto), ao contrário de `Object.assign`.
 */
export class MemoryStoreF5 {
  protected readonly state!: MemoryState;

  // ------------------------------------------------- chaves de API ---

  async createApiKey(input: {
    workspaceId: string;
    name: string;
    prefix: string;
    keyHash: string;
    scopes?: ApiKeyScope[];
    createdBy?: string | null;
  }) {
    return f5keys.createApiKey(this.state, input);
  }

  async listApiKeys(workspaceId: string) {
    return f5keys.listApiKeys(this.state, workspaceId);
  }

  async findApiKeyByHash(keyHash: string) {
    return f5keys.findApiKeyByHash(this.state, keyHash);
  }

  async touchApiKey(workspaceId: string, id: string) {
    return f5keys.touchApiKey(this.state, workspaceId, id);
  }

  async revokeApiKey(workspaceId: string, id: string) {
    return f5keys.revokeApiKey(this.state, workspaceId, id);
  }

  // -------------------------------------------------- webhooks ---

  async createWebhookEndpoint(input: {
    workspaceId: string;
    name: string;
    url: string;
    secret: string;
    events?: string[];
  }) {
    return f5keys.createWebhookEndpoint(this.state, input);
  }

  async listWebhookEndpoints(workspaceId: string) {
    return f5keys.listWebhookEndpoints(this.state, workspaceId);
  }

  async findWebhookEndpoint(workspaceId: string, id: string) {
    return f5keys.findWebhookEndpoint(this.state, workspaceId, id);
  }

  async deleteWebhookEndpoint(workspaceId: string, id: string) {
    return f5keys.deleteWebhookEndpoint(this.state, workspaceId, id);
  }

  async enqueueWebhookDelivery(input: {
    workspaceId: string;
    endpointId: string;
    event: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: string;
  }) {
    return f5keys.enqueueWebhookDelivery(this.state, input);
  }

  async listWebhookDeliveries(
    workspaceId: string,
    filter?: { endpointId?: string; status?: WebhookDeliveryStatus },
  ) {
    return f5keys.listWebhookDeliveries(this.state, workspaceId, filter);
  }

  async markWebhookDelivery(
    workspaceId: string,
    id: string,
    patch: {
      status?: WebhookDeliveryStatus;
      attempts?: number;
      nextAttemptAt?: string;
      responseCode?: number | null;
      lastError?: string | null;
    },
  ) {
    return f5keys.markWebhookDelivery(this.state, workspaceId, id, patch);
  }

  // ------------------------------------------------------ CSAT ---

  async rateConversation(input: {
    workspaceId: string;
    conversationId: string;
    score: number;
    comment?: string | null;
    source?: RatingSource;
    ratedBy?: string | null;
  }) {
    return f5lgpd.rateConversation(this.state, input);
  }

  async findRating(workspaceId: string, conversationId: string) {
    return f5lgpd.findRating(this.state, workspaceId, conversationId);
  }

  async listRatings(workspaceId: string, options?: { conversationIds?: string[] }) {
    return f5lgpd.listRatings(this.state, workspaceId, options);
  }

  // ------------------------------------------------------ LGPD ---

  async setConsent(input: {
    workspaceId: string;
    contactId: string;
    kind: ConsentKind;
    granted: boolean;
    source?: string;
    note?: string | null;
  }) {
    return f5lgpd.setConsent(this.state, input);
  }

  async listConsents(
    workspaceId: string,
    filter?: { contactId?: string; kind?: ConsentKind },
  ) {
    return f5lgpd.listConsents(this.state, workspaceId, filter);
  }

  async addLgpdRequest(input: {
    workspaceId: string;
    contactId?: string | null;
    scope: "contato" | "workspace";
    action: "acesso" | "exclusao";
    status?: "concluido" | "parcial";
    summary: Record<string, unknown>;
    requestedBy?: string | null;
  }) {
    return f5lgpd.addLgpdRequest(this.state, input);
  }

  async listLgpdRequests(workspaceId: string) {
    return f5lgpd.listLgpdRequests(this.state, workspaceId);
  }

  async purgeContactData(workspaceId: string, contactId: string) {
    return f5lgpd.purgeContactData(this.state, workspaceId, contactId);
  }

  async purgeWorkspaceContacts(workspaceId: string) {
    return f5lgpd.purgeWorkspaceContacts(this.state, workspaceId);
  }

  // ---------------------------------------------------- fluxos + módulos ---

  async createFlow(input: {
    workspaceId: string;
    name: string;
    terms?: string[];
    active?: boolean;
    steps: Array<{ action: FlowAction; payload: Record<string, unknown> }>;
  }) {
    return f5flows.createFlow(this.state, input);
  }

  async listFlows(workspaceId: string) {
    return f5flows.listFlows(this.state, workspaceId);
  }

  async findFlowById(workspaceId: string, id: string) {
    return f5flows.findFlowById(this.state, workspaceId, id);
  }

  async setFlowActive(workspaceId: string, id: string, active: boolean) {
    return f5flows.setFlowActive(this.state, workspaceId, id, active);
  }

  async deleteFlow(workspaceId: string, id: string) {
    return f5flows.deleteFlow(this.state, workspaceId, id);
  }

  async listWorkspaceModules(workspaceId: string) {
    return f5flows.listWorkspaceModules(this.state, workspaceId);
  }

  async setWorkspaceModule(input: {
    workspaceId: string;
    moduleKey: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }) {
    return f5flows.setWorkspaceModule(this.state, input);
  }

  /** Fábrica dos mapas da F5, chamada pelo `MemoryStore` ao montar o estado. */
  static createF5Maps() {
    return {
      ...f5keys.createF5KeysMaps(),
      ...f5lgpd.createF5LgpdMaps(),
      ...f5flows.createF5FlowsMaps(),
    };
  }
}