export interface QueueRecord {
  id: string;
  workspaceId: string;
  name: string;
  channel: string | null;
  isDefault: boolean;
  createdAt: string;
}

export type TicketStatus = "aguardando" | "em_atendimento" | "resolvido" | "cancelado";

export interface QueueTicketRecord {
  id: string;
  workspaceId: string;
  queueId: string;
  conversationId: string;
  channel: string;
  status: TicketStatus;
  assignedUserId: string | null;
  enqueuedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueuesStore {
  // ---- F3: filas ----
  createQueue(input: {
    workspaceId: string;
    name: string;
    channel?: string | null;
    isDefault?: boolean;
  }): Promise<QueueRecord>;
  listQueues(workspaceId: string): Promise<QueueRecord[]>;
  findQueueById(workspaceId: string, id: string): Promise<QueueRecord | null>;
  deleteQueue(workspaceId: string, id: string): Promise<boolean>;
  addQueueMember(input: {
    workspaceId: string;
    queueId: string;
    userId: string;
  }): Promise<void>;
  removeQueueMember(
    workspaceId: string,
    queueId: string,
    userId: string,
  ): Promise<boolean>;
  /** Ids de usuário dos atendentes da fila, por ordem de entrada. */
  listQueueMembers(workspaceId: string, queueId: string): Promise<string[]>;
}

export interface QueueTicketsStore {
  // ---- F3: tickets da fila ----
  enqueueTicket(input: {
    workspaceId: string;
    queueId: string;
    conversationId: string;
    channel: string;
  }): Promise<QueueTicketRecord>;
  listTickets(
    workspaceId: string,
    filter?: { queueId?: string; status?: string; assignedUserId?: string },
  ): Promise<QueueTicketRecord[]>;
  findTicketById(
    workspaceId: string,
    id: string,
  ): Promise<QueueTicketRecord | null>;
  findOpenTicketByConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<QueueTicketRecord | null>;
  updateTicket(
    workspaceId: string,
    id: string,
    patch: {
      status?: TicketStatus;
      assignedUserId?: string | null;
      firstResponseAt?: string | null;
      resolvedAt?: string | null;
    },
  ): Promise<QueueTicketRecord | null>;
  /** 1ª resposta humana numa conversa com ticket aberto → carimba first_response_at. */
  markTicketFirstResponse(
    workspaceId: string,
    conversationId: string,
  ): Promise<QueueTicketRecord | null>;
  /** Conversa resolvida → ticket aberto vira resolvido (se não havia resposta, carimba resolvedAt). */
  resolveOpenTicketForConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<QueueTicketRecord | null>;
}
