import { describe, expect, it } from "vitest";
import { canInvite, hasRank, isMemberRole } from "../src/index.js";

describe("roles", () => {
  it("hierarquia e convites", () => {
    expect(hasRank("admin_ws", "supervisor")).toBe(true);
    expect(hasRank("atendente", "admin_ws")).toBe(false);
    expect(canInvite("admin_ws", "supervisor")).toBe(true);
    expect(canInvite("supervisor", "atendente")).toBe(false);
    expect(isMemberRole("owner_global")).toBe(false);
  });
});
