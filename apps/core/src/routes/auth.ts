import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "@agentsroom/shared";
import type { Store } from "../stores/store.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

const registerSchema = z.object({
  email: z.string().email("E-mail inválido."),
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
  name: z.string().min(1, "Nome é obrigatório.").max(120),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido."),
  password: z.string().min(1, "Senha é obrigatória."),
});

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  isOwnerGlobal: boolean;
}): unknown {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isOwnerGlobal: user.isOwnerGlobal,
  };
}

export async function authRoutes(
  app: FastifyInstance,
  store: Store,
  jwtExpiresIn: string,
): Promise<void> {
  // Primeiro usuário da instalação vira o dono (owner_global). Demais: comuns.
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.parse(await request.body);
    const existing = await store.findUserByEmail(body.email);
    if (existing) {
      throw HttpError.conflict("email_em_uso", "E-mail já cadastrado.");
    }
    const isFirst = (await store.countUsers()) === 0;
    const user = await store.createUser({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      name: body.name,
      isOwnerGlobal: isFirst,
    });
    const token = await reply.jwtSign(
      { email: user.email, isOwnerGlobal: user.isOwnerGlobal },
      { sub: user.id, expiresIn: jwtExpiresIn },
    );
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.parse(await request.body);
    const user = await store.findUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw HttpError.unauthorized("Credenciais inválidas.");
    }
    const token = await reply.jwtSign(
      { email: user.email, isOwnerGlobal: user.isOwnerGlobal },
      { sub: user.id, expiresIn: jwtExpiresIn },
    );
    return { token, user: publicUser(user) };
  });

  app.get(
    "/me",
    { onRequest: [app.authenticate] },
    async (request) => {
      const user = await store.findUserById(request.authUser.id);
      if (!user) throw HttpError.unauthorized("Usuário não existe mais.");
      const memberships = await store.listMembershipsByUser(user.id);
      return {
        user: publicUser(user),
        memberships: memberships.map((m) => ({
          workspaceId: m.workspaceId,
          role: m.role,
        })),
      };
    },
  );
}
