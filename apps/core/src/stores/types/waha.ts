export type WahaSessionStatus =
  | "criada"
  | "qr"
  | "conectada"
  | "desconectada"
  | "erro"
  | "encerrada";

export interface WahaSessionRecord {
  id: string;
  workspaceId: string;
  name: string;
  engine: string;
  status: WahaSessionStatus | string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WahaSessionsStore {
  // sessões WAHA/WhatsApp (1+ por workspace)
  createWahaSession(input: {
    workspaceId: string;
    name: string;
    engine?: string;
  }): Promise<WahaSessionRecord>;
  listWahaSessions(workspaceId: string): Promise<WahaSessionRecord[]>;
  findWahaSessionById(
    workspaceId: string,
    id: string,
  ): Promise<WahaSessionRecord | null>;
  findWahaSessionByName(name: string): Promise<WahaSessionRecord | null>;
  updateWahaSession(
    workspaceId: string,
    id: string,
    patch: { status?: string; phone?: string | null },
  ): Promise<WahaSessionRecord | null>;
}
