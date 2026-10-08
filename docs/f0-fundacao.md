# F0 — Fundação: monorepo, auth/workspaces, RLS e Coolify

## Visão geral

Base de tudo: monorepo npm workspaces (`apps/core`, `packages/shared`, `packages/db`),
auth JWT com workspaces e convites, isolamento tenant em 2 camadas e deploy no Coolify
(2 projetos, 6 recursos próprios cada). Build ordenado: shared → db → core.

## Auth e papéis

- Primeiro usuário registrado vira `owner_global` (visão transversal, bypassa membership).
- Papéis por workspace: `admin_ws` > `supervisor` > `atendente` (`packages/shared`).
- Convites: token opaco, só o hash SHA-256 persistido; aceite exige e-mail igual ao convidado.
- Seed do dono via `seed.ts` ou primeiro `POST /auth/register`.

## Isolamento (2 camadas)

1. App: `requireWorkspace` → `403` sem membership, `401` sem token.
2. Banco: RLS `FORCE ROW LEVEL SECURITY` em todas as tabelas (`migrations/001_init.sql`),
   role `app_user` sem `BYPASSRLS`, `SET LOCAL app.current_workspace_id/user_id` por transação.
   Tabelas globais (`users`, `workspaces`): RLS permissivo + autorização no app.
   Tabelas tenant (`workspace_members`, `invites`, `contacts`): escopo estrito.

## Persistência e deploy

- Interface `Store`: `MemoryStore` (dev/teste) e `PostgresStore`; `STORE_DRIVER` seleciona.
- Coolify: `coolify/docker-compose.prod.yml` (main) e `.staging.yml` (staging);
  entrypoint roda `migrate` sozinho no boot. CI `ci.yml` (typecheck+test),
  `cd-core.yml` rebuilda só o core na main via `paths:`.

## Testes

`tests/isolation.test.ts` (403 cross-workspace, 401 sem token, fluxo de convite,
acesso transversal do dono) e `tests/coolify.test.ts` (contrato dos recursos).
