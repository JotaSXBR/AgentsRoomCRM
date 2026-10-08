export interface ContactRecord {
  id: string;
  workspaceId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Contato absorvido por um merge aponta para o sobrevivente. */
  mergedIntoId: string | null;
  createdAt: string;
}

/** Canal do contato unificado (multicanal: whatsapp, e-mail, ...). */
export interface ContactChannelRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  channel: string;
  value: string;
  createdAt: string;
}

/** Evento da timeline do contato (merge, notas de canal, etc.). */
export interface ContactEventRecord {
  id: string;
  workspaceId: string;
  contactId: string;
  conversationId: string | null;
  kind: string;
  actorId: string | null;
  description: string;
  createdAt: string;
}

export interface ContactsStore {
  // contacts (entidade tenant de exemplo)
  createContact(input: {
    workspaceId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
  }): Promise<ContactRecord>;
  listContacts(workspaceId: string, query?: { q?: string }): Promise<ContactRecord[]>;
  findContactById(workspaceId: string, id: string): Promise<ContactRecord | null>;
  addContactChannel(input: {
    workspaceId: string;
    contactId: string;
    channel: string;
    value: string;
  }): Promise<ContactChannelRecord>;
  listContactChannels(workspaceId: string, contactId: string): Promise<ContactChannelRecord[]>;
  /** Move canais/conversas/eventos de `sourceId` para `targetId` e marca o source como absorvido. */
  mergeContacts(workspaceId: string, sourceId: string, targetId: string): Promise<ContactRecord>;
  contactTimeline(workspaceId: string, contactId: string): Promise<ContactEventRecord[]>;
  addContactEvent(input: {
    workspaceId: string;
    contactId: string;
    conversationId?: string | null;
    kind: string;
    actorId?: string | null;
    description: string;
  }): Promise<ContactEventRecord>;
}
