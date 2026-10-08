# F2a — Widget do site, WhatsApp (WAHA/GOWS) e intake idempotente

## Visão geral

Captação web + WhatsApp convergindo no mesmo intake: contato resolvido por canal/valor
(telefone igual unifica widget ↔ WhatsApp no mesmo contato), conversa aberta do canal
ou nova, mensagem de entrada. Deduplicação por `intake_events` antes de escrever.

## Widget

- `GET /widget.js` (JS autocontido, token via `data-token` da tag script).
- `POST /public/widget/intake` (Bearer ou `?token=`); token guardado como SHA-256 em
  `widget_tokens`; revogação invalida o intake. CRUD admin em `.../widget/tokens`
  (lista sem hash, segredo volta uma vez).

## WhatsApp (WAHA com engine GOWS)

- Adapter isolado em `src/waha/` (interface `WhatsAppAdapter`, impl HTTP, parse normalizado).
  O core nunca fala HTTP com o WAHA fora de `src/waha/` — a Cloud API oficial entraria
  como nova implementação da mesma interface.
- Sessões 1+ por workspace: `.../whatsapp/sessions` (criar, QR, status, reconnect, delete).
- Deploy: imagem `devlikeapro/waha:gows` + `WHATSAPP_DEFAULT_ENGINE=GOWS`, sessões em
  `/app/.sessions`, `REDIS_URL` obrigatório (jobs/background).
- Webhook: `POST /webhooks/waha` com segredo (`x-webhook-secret` ou `?secret=`),
  eventos `message`/`session.status`, logs por `workspaceId`.

## Idempotência

`intake_events` com `UNIQUE(workspace_id, source, external_id)`; claim **antes** de criar
a mensagem (webhook WAHA e `clientMessageId` do widget usam a mesma normalização).
Migração `003_f2a.sql`; `widget_tokens`/`waha_sessions` com `SELECT` aberto
(precedente `invites`: lookup global por capability, escrita sempre tenant).

## Testes

`tests/f2a.test.ts`: ciclo do token, idempotência, sessões via adapter fake e webhook
unificando contato widget+WhatsApp no mesmo workspace.
