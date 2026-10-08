import { EventEmitter } from "node:events";

export interface RealtimeEvent {
  kind:
    | "conversa.criada"
    | "conversa.atualizada"
    | "mensagem.criada"
    | "nota.criada"
    | "tag.adicionada"
    | "tag.removida"
    | "fila.ticket"
    | "fila.rebalance";
  workspaceId: string;
  data: unknown;
  at: string;
}

/**
 * Barramento em processo das rooms `ws:{workspaceId}`.
 * Todo evento carrega o workspaceId — um cliente só recebe eventos da sua room.
 */
export class RealtimeHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  static room(workspaceId: string): string {
    return `ws:${workspaceId}`;
  }

  publish(workspaceId: string, event: Omit<RealtimeEvent, "workspaceId" | "at">): void {
    const full: RealtimeEvent = {
      ...event,
      workspaceId,
      at: new Date().toISOString(),
    };
    this.emitter.emit(RealtimeHub.room(workspaceId), full);
  }

  subscribe(workspaceId: string, listener: (event: RealtimeEvent) => void): () => void {
    const room = RealtimeHub.room(workspaceId);
    this.emitter.on(room, listener);
    return () => this.emitter.off(room, listener);
  }
}
