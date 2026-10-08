# F1 — Inbox unificado, contatos multicanal e realtime

## Visão geral

Caixa unificada por workspace (conversas/mensagens/notas/tags), contatos que juntam
vários canais, realtime via websocket com fallback de polling e upload via presign S3.
Web responsivo em `GET /app/inbox` (`apps/core/public/inbox.html`).

## Inbox

- Conversas com atribuição manual (`PATCH .../conversations/:id` com `assigneeId`/`status`),
  pesquisa por `q`/`status`/`tagId`.
- Realtime: `GET /workspaces/:id/ws?token=` (JWT na query, browser não manda header no WS),
  room `ws:{workspaceId}` via `RealtimeHub`; todo evento carrega `workspaceId`.
- Fallback: `GET .../inbox/updates?since=` derivado de `conversations.updated_at` +
  `messages.created_at` (sem tabela global de eventos).

## Contatos

- `contact_channels` (canal+valor); `mergeContacts` move canais/conversas/eventos para o
  sobrevivente e marca `merged_into_id`; histórico em `contact_events`.
- Migração `002_inbox.sql`: RLS forçado nas 7 tabelas novas + `merged_into_id`.

## Mídia

`POST .../media/presign` → URL pré-assinada S3/RustFS (path-style, 15 min),
key `{workspaceId}/{uuid}-{nome}`, limite 25 MB. Presign não faz rede (teste usa endpoint falso).

## Testes

`tests/inbox.test.ts`: caixa completa (lista, atribui, status, notas, tags, pesquisa) e
realtime com 2 atendentes no mesmo workspace sem vazar para outro.
