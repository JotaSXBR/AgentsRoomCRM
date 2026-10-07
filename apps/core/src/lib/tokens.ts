import { createHash, randomBytes } from "node:crypto";

/** Gera token de convite (segredo) e seu hash SHA-256 (o que é persistido). */
export function newInviteToken(bytes = 32): { token: string; tokenHash: string } {
  const token = randomBytes(bytes).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteExpiresAt(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600_000).toISOString();
}

export function isExpired(expiresAt: string, at: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= at.getTime();
}
