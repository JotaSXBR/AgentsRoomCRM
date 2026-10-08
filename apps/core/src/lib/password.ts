import bcrypt from "bcryptjs";

// Produção usa 12. Em teste (Vitest define NODE_ENV=test) usa 4:
// o teste pesado de distribuição cria 12 usuários via /auth/register
// e com 12 rounds estoura o timeout de 5s sob carga do suite completo.
const ROUNDS =
  Number(process.env.BCRYPT_ROUNDS ?? NaN) ||
  (process.env.NODE_ENV === "test" || process.env.VITEST_POOL_ID !== undefined ? 4 : 12);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
