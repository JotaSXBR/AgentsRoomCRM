export interface WidgetTokenRecord {
  id: string;
  workspaceId: string;
  name: string;
  tokenHash: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface WidgetTokensStore {
  // widget tokens
  createWidgetToken(input: {
    workspaceId: string;
    name: string;
    tokenHash: string;
  }): Promise<WidgetTokenRecord>;
  listWidgetTokens(workspaceId: string): Promise<WidgetTokenRecord[]>;
  findWidgetTokenByHash(tokenHash: string): Promise<WidgetTokenRecord | null>;
  revokeWidgetToken(workspaceId: string, id: string): Promise<boolean>;
}
