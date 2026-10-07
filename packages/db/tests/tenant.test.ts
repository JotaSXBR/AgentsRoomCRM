import { describe, expect, it } from "vitest";
import {
  assertWorkspace,
  isUuid,
  scopeWhere,
  setUserContextSql,
  setWorkspaceContextSql,
} from "../src/index.js";

describe("tenant helpers", () => {
  it("assertWorkspace rejeita vazio", () => {
    expect(() => assertWorkspace("")).toThrow();
    expect(() => assertWorkspace(undefined)).toThrow();
    expect(assertWorkspace("ws-1")).toBe("ws-1");
  });

  it("scopeWhere gera predicado parametrizado", () => {
    expect(scopeWhere("ws-1")).toEqual({
      clause: "workspace_id = $1",
      params: ["ws-1"],
    });
  });

  it("contextos RLS usam set_config local", () => {
    expect(setWorkspaceContextSql("ws-1").text).toMatch(
      /set_config\('app\.current_workspace_id'/,
    );
    expect(setUserContextSql("u-1").text).toMatch(
      /set_config\('app\.current_user_id'/,
    );
  });

  it("isUuid valida formato", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("ws-1")).toBe(false);
  });
});
