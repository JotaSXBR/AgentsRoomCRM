# F3 — Bot por regras, filas/distribuição e SLA básico

## Visão geral

- **Bot por regras** (`src/bot/`): avaliado em todo intake não duplicado
  (webhook WAHA, Meta, e-mail, widget). Regras em `bot_rules` com
  `kind` ∈ `palavra_chave | menu | triagem`, `priority` (menor = primeiro),
  `terms` (casamento por substring, case-insensitive) e `queue_id` opcional.
- **Horário/ausência**: `workspace_settings.business_hours`
  (chaves `"0".."6"` = getDay; faixas `["HH:MM","HH:MM"]`; vazio = fechado;
  mapa vazio = sempre aberto). Fora do horário, o contato recebe
  `absence_message` e um ticket entra na fila padrão — uma vez por ticket aberto.
- **Menus**: regra `menu` envia `reply` com as opções; a próxima mensagem do
  contato (dígito ou label) escolhe a opção (`options[].reply`) e pode enfileirar
  (`options[].queueId`). Estado em `bot_sessions`.
- **Fila**: `queues` (1 padrão por workspace), membros em `queue_members`,
  atendimento em `queue_tickets` (`aguardando | em_atendimento | resolvido |
  cancelado`). Distribuição automática por menor carga
  (`leastLoadedAssignee` em `src/queues/assign.ts`), empate na ordem de
  entrada na fila.
- **Supervisão**: supervisor/admin transfere ticket
  (`POST .../tickets/:id/transfer`) ou rebalanceia os `aguardando` de um
  atendente (`POST .../queues/:queueId/rebalance`).
- **SLA**: `GET /workspaces/:id/metrics/sla?from&to&groupBy=queue|channel|
  assignee|all`. TME = `first_response_at - enqueued_at`; TMA =
  `resolved_at - first_response_at` (sem 1ª resposta: `resolved_at -
  enqueued_at`). `first_response_at` é carimbado na primeira mensagem
  `saida` humana da conversa; `resolved_at` quando a conversa vira `resolvido`
  ou o ticket é resolvido via PATCH.

## Rotas novas

| Método | Rota | Papel mínimo |
| --- | --- | --- |
| GET/PUT | `/workspaces/:id/settings` | membro / supervisor+ |
| GET/POST/DELETE | `/workspaces/:id/queues[...]` | membro / supervisor+ |
| GET/POST/DELETE | `/workspaces/:id/queues/:queueId/members[...]` | membro / supervisor+ |
| GET/POST | `/workspaces/:id/queues/tickets`, `/queues/:queueId/tickets` | membro |
| PATCH | `/workspaces/:id/queues/tickets/:ticketId` | membro (transferência exige supervisor+) |
| POST | `/workspaces/:id/queues/tickets/:ticketId/transfer` | supervisor+ |
| POST | `/workspaces/:id/queues/:queueId/rebalance` | supervisor+ |
| GET/POST/PATCH/DELETE | `/workspaces/:id/bots[...]` | membro / supervisor+ |
| GET | `/workspaces/:id/metrics/sla` | membro |

## Banco

`migrations/005_f3.sql`: `workspace_settings`, `queues`, `queue_members`,
`queue_tickets`, `bot_rules`, `bot_sessions` — todas com RLS FORÇADO e
policy tenant por `app.current_workspace_id`.
