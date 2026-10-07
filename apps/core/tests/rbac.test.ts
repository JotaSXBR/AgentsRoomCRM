import { describe, expect, it } from "vitest";
import {
  canInvite,
  effectiveRole,
  hasRank,
  isMemberRole,
  isWorkspaceRole,
  parsePage,
  HttpError,
} from "@agentsroom/shared";

describe("papéis e hierarquia", () => {
  it("reconhece papéis válidos", () => {
    expect(isWorkspaceRole("owner_global")).toBe(true);
    expect(isWorkspaceRole("admin_ws")).toBe(true);
    expect(isMemberRole("owner_global")).toBe(false);
    expect(isMemberRole("atendente")).toBe(true);
    expect(isWorkspaceRole("root")).toBe(false);
  });

  it("hierarquia: admin > supervisor > atendente", () => {
    expect(hasRank("admin_ws", "atendente")).toBe(true);
    expect(hasRank("supervisor", "atendente")).toBe(true);
    expect(hasRank("atendente", "supervisor")).toBe(false);
    expect(hasRank("supervisor", "supervisor")).toBe(true);
  });

  it("convites: só admin_ws e owner_global convidam", () => {
    expect(canInvite("owner_global", "admin_ws")).toBe(true);
    expect(canInvite("admin_ws", "atendente")).toBe(true);
    expect(canInvite("admin_ws", "supervisor")).toBe(true);
    expect(canInvite("supervisor", "atendente")).toBe(false);
    expect(canInvite("atendente", "atendente")).toBe(false);
  });

  it("papel efetivo: owner_global vence membership", () => {
    expect(
      effectiveRole({ isOwnerGlobal: true }, { workspaceId: "w", role: "atendente" }),
    ).toBe("owner_global");
    expect(
      effectiveRole({ isOwnerGlobal: false }, { workspaceId: "w", role: "supervisor" }),
    ).toBe("supervisor");
    expect(effectiveRole({ isOwnerGlobal: false }, null)).toBeNull();
  });
});

describe("paginação e erros HTTP", () => {
  it("limites de paginação", () => {
    expect(parsePage({})).toEqual({ limit: 20, offset: 0 });
    expect(parsePage({ limit: 500 })).toEqual({ limit: 100, offset: 0 });
    expect(parsePage({ limit: -3, offset: -1 })).toEqual({ limit: 1, offset: 0 });
  });

  it("403 padrão é 'sem acesso ao workspace'", () => {
    const error = HttpError.forbidden();
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/workspace/i);
  });
});
