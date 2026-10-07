import { z } from "zod";

export const STATUS = z.enum(["aberto", "pendente", "resolvido"]);

export const createConversationSchema = z.object({
  contactId: z.string().uuid(),
  channel: z.string().min(1).max(40),
  subject: z.string().max(200).nullish(),
});

export const messageSchema = z.object({
  direction: z.enum(["entrada", "saida"]).default("saida"),
  text: z.string().max(8000).nullish(),
  mediaUrl: z.string().url().nullish(),
  kind: z.enum(["texto", "midia", "sistema"]).default("texto"),
});

export const noteSchema = z.object({
  content: z.string().min(1).max(4000),
});

export const patchConversationSchema = z
  .object({
    status: STATUS.optional(),
    assigneeId: z.string().uuid().nullish(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "Nada para atualizar.",
  });

export const tagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullish(),
});
