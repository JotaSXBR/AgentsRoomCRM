/** Conexão Meta oficial por workspace (1 Página + IG vinculado). */
export interface MetaConnectionRecord {
  id: string;
  workspaceId: string;
  pageId: string;
  pageName: string | null;
  igUserId: string | null;
  /** Token da Página CIFRADO (AES-256-GCM) — nunca sai do workspace. */
  accessTokenEnc: string;
  tokenExpiresAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetaStore {
  // conexão Meta oficial (1 Página + IG por workspace)
  saveMetaConnection(input: {
    workspaceId: string;
    pageId: string;
    pageName?: string | null;
    igUserId?: string | null;
    accessTokenEnc: string;
    tokenExpiresAt?: string | null;
    status?: string;
  }): Promise<MetaConnectionRecord>;
  getMetaConnection(workspaceId: string): Promise<MetaConnectionRecord | null>;
  deleteMetaConnection(workspaceId: string): Promise<boolean>;
  /** Índice global Página → workspace (só ids, usado pelo webhook). */
  findWorkspaceIdByMetaPage(pageId: string): Promise<string | null>;
}
