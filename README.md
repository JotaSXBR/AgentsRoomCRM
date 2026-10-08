# AgentsRoomCRM

Monorepo TypeScript — CRM multicanal por workspace: fundação + auth (F0), inbox unificado (F1), widget/WhatsApp (F2a), Meta + e-mail (F2b), bot/filas/SLA (F3), IA híbrida (F4), API pública + MCP + LGPD (F5).

```
apps/
  core/            API (Fastify): auth JWT, workspaces, convites, isolamento tenant,
                   inbox, contatos multicanal, realtime (ws + polling), presign S3,
                   widget, WhatsApp (WAHA/GOWS), Meta, e-mail, bot, filas, IA, MCP
packages/
  shared/          papéis, RBAC, tipos, erros HTTP (@agentsroom/shared)
  db/              helpers multi-tenant + RLS (@agentsroom/db)
coolify/           2 projetos (prod/staging), 6 recursos próprios por projeto
docs/              guias por entrega (f0, f1, f2a, f2b, f3, f4, f5)
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
  as tabelas** (`apps/core/migrations/001_init.sql` e seguintes), com
  `SET LOCAL app.current_workspace_id` por transação e role `app_user`
  sem `BYPASSRLS`.

## Módulos por entrega

| Entrega | O que é | Doc |
|---|---|---|
| F0 fundação | Auth, workspaces, convites, RLS, Coolify | `docs/f0-fundacao.md` |
| F1 inbox | Conversas, contatos multicanal, realtime ws+polling, presign S3, web `/app/inbox` | `docs/f1-inbox.md` |
| F2a widget+WhatsApp | `GET /widget.js`, intake idempotente, sessões WAHA/GOWS, `POST /webhooks/waha` | `docs/f2a-widget-waha.md` |
| F2b Meta+e-mail | Graph API v21 (Página/IG), SMTP/IMAP, fila outbound com backoff | `docs/f2b-meta-email.md` |
| F3 bot+filas+SLA | Regras (ausência/horário/menu/triagem), distribuição por carga, `GET .../metrics/sla` | `docs/f3-bot-filas-sla.md` |
| F4 IA híbrida | BYOK + Ollama + RAG por workspace, fallback humano (opt-in, `enabled=false`) | `docs/f4-ia-hibrida.md` |
| F5 API+MCP+LGPD | Chaves `ark_live_*`, `POST /mcp` (JSON-RPC), fluxos, webhooks assinados, relatórios, LGPD/backup | `docs/f5-api-mcp-relatorios-lgpd.md` |

## Endpoints (grupos)

| Grupo | Rotas |
|---|---|
| Saúde | `GET /health`, `/ready` |
| Auth | `POST /auth/register`, `/auth/login`, `GET /me` |
| Workspaces | `POST/GET /workspaces`, `GET /workspaces/:id`, `.../members`, `.../invites`, `POST /invites/accept` |
| Contatos | `GET/POST /workspaces/:id/contacts`, `GET .../contacts/:id`, `.../timeline`, `.../channels`, `.../merge` |
| Inbox | `GET/POST .../inbox/conversations`, `GET/PATCH .../conversations/:id`, `.../messages\|notes\|tags\|rating`, `GET/POST .../tags`, `GET .../inbox/updates?since=`, `GET .../ws?token=`, `GET /app/inbox` |
| Mídia | `POST .../media/presign` |
| Widget | `GET /widget.js`, `POST /public/widget/intake`, CRUD `.../widget/tokens` |
| WhatsApp | CRUD `.../whatsapp/sessions` (QR, status, reconnect), `POST /webhooks/waha` |
| Meta | `.../meta` (oauth-url, connect, connection, send), `GET+POST /webhooks/meta` |
| E-mail | CRUD `.../mail/mailboxes`, `.../mail/send`, `POST .../mail/sync`, `POST .../outbound/process` |
| Bot/filas | CRUD `.../bot/rules`, `.../settings`, CRUD `.../queues`, `.../tickets` (transfer/rebalance), `GET .../metrics/sla` |
| IA | `.../ai/settings`, `.../ai/providers`, `.../ai/sources` (+sync), `.../ai/logs` |
| F5 | `.../api-keys`, `.../webhooks` (+deliveries), `POST /mcp`, `GET /mcp/tools`, `GET .../reports/quality` (+`.csv`), `.../contacts/:id/consents\|export`, `DELETE .../data`, `GET .../lgpd/requests` |

Critérios: push na main rebuilda só o core (`cd-core.yml` com `paths:`),
staging com recursos próprios, e `tests/isolation.test.ts` falha com 403
para cross-workspace sem acesso. Restore de backup em staging ainda não foi
ensaiado (único aceite em aberto da F5 — ver doc da F5).
