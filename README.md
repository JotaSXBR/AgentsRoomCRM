# AgentsRoomCRM

Monorepo TypeScript — F0: fundação + auth/workspaces + Coolify.

```
apps/
  core/            API (Fastify): auth JWT, workspaces, convites, isolamento tenant
packages/
  shared/          papéis, RBAC, tipos, erros HTTP (@agentsroom/shared)
  db/              helpers multi-tenant + RLS (@agentsroom/db)
coolify/           projeto Coolify: 1 projeto, 2 ambientes (prod/staging),
               6 recursos separados por ambiente (guias em resources/)
.github/workflows/ ci (typecheck+test) e cd-core (rebuild só do core na main)
```

## Início rápido

```bash
cp .env.example .env
npm install
npm run typecheck
npm run test
npm run dev:core        # STORE_DRIVER=memory por padrão (dev/teste)
```

Produção/staging: `STORE_DRIVER=postgres`; o entrypoint roda o `migrate`
sozinho no boot (role migrador via `DATABASE_URL_MIGRATOR`).
Detalhes em [`coolify/README.md`](coolify/README.md).

## Auth e workspaces (F0)

- Primeiro usuário registrado vira **dono** (`owner_global`, visão transversal).
- Workspaces com papéis `admin_ws` > `supervisor` > `atendente`.
- Convites: `POST /workspaces/:id/invites` (só `admin_ws`/`owner_global`)
  retorna o token **uma vez**; aceite em `POST /invites/accept` pelo usuário
  cujo e-mail é o do convite.
- Isolamento total: toda rota tenant exige membership (`403` sem acesso,
  `401` sem token); `owner_global` bypassa. Segunda camada: **RLS em todas
  as tabelas** (`apps/core/migrations/001_init.sql`), com
  `SET LOCAL app.current_workspace_id` por transação e role `app_user`
  sem `BYPASSRLS`. Tabelas globais (`users`, `workspaces`) têm RLS ativo com
  policies permissivas + autorização na camada app; tabelas tenant
  (`workspace_members`, `invites`, `contacts`) são estritamente escopadas.

## Endpoints

| Método | Rota | Acesso |
|---|---|---|
| GET | `/health`, `/ready` | público |
| POST | `/auth/register`, `/auth/login` | público |
| GET | `/me` | autenticado |
| POST / GET | `/workspaces` | autenticado |
| GET | `/workspaces/:id`, `.../members` | membro ou dono |
| POST | `/workspaces/:id/invites` | `admin_ws` ou dono |
| POST | `/invites/accept` | dono do e-mail convidado |
| GET / POST | `/workspaces/:id/contacts` | membro ou dono |

Critérios F0: push na main rebuilda só o core (`cd-core.yml` com `paths:`),
staging com recursos próprios, e `tests/isolation.test.ts` falha com 403
para cross-workspace sem acesso.
