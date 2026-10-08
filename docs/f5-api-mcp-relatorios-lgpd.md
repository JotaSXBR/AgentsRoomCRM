# F5 — API pública, servidor MCP, relatórios TME/TMA/CSAT, LGPD e backup

## Visão geral

Quatro entregas que se sustentam:

- **Chaves de API por workspace** (`api_keys`): autenticação
  machine-to-machine. O segredo (`ark_live_<público>.<secreto>`) volta
  **uma única vez**; o servidor guarda só o SHA-256. O formato `prefixo.secredo`
  existe para o humano reconhecer a chave na UI sem ver nada útil. Escopos:
  `mcp`, `api:leitura`, `api:escrita`.
- **Servidor MCP** (`POST /mcp`): JSON-RPC 2.0 sobre HTTP, sem dependência nova
  (o SDK do MCP não está no projeto). É isto que permite a um agente externo
  (Claude, Codex, OpenCode) configurar o CRM sem abrir a UI.
- **Relatórios de qualidade**: TME/TMA/CSAT por atendente, fila ou canal,
  com SLA% contra meta opcional e exportação CSV.
- **LGPD + backup**: consentimento por finalidade, exportação e eliminação de
  dados do titular com trilha de auditoria; dumps do Postgres e dos volumes
  indo para o RustFS.

## MCP

### Transporte

`POST /mcp`, JSON-RPC 2.0. Métodos: `initialize`,
`notifications/initialized`, `ping`, `tools/list`, `tools/call`.

Sem estado de sessão: cada requisição é autocontida, então o servidor escala
horizontalmente sem stickiness. `GET /mcp/tools` devolve o catálogo filtrado
pelos escopos da chave (descoberta sem abrir sessão).

Autenticação por chave de API (`Authorization: Bearer` ou `X-API-Key`), em
`src/api/authApiKey.ts`.

### Isolamento entre tenants (a parte que importa)

A chave carrega o próprio tenant. O `workspaceId` das tools é **injetado pelo
servidor** a partir da chave; um argumento conflitante enviado pelo agente é
sobrescrito, nunca respeitado (`src/mcp/dispatcher.ts`, função
`withScopedWorkspace`). Sem isso, a tool viraria um caminho de escape de
workspace. Há teste cobrindo exatamente isso.

### Tools

Automação (`src/mcp/toolsAutomation.ts`):

| Tool | O que faz |
| --- | --- |
| `criar_fila` | Cria fila; nome repetido vira mensagem legível, não código cru |
| `listar_filas` | Filas com id, nome, canal, se é a padrão |
| `criar_regra_bot` | Regra `palavra_chave \| menu \| triagem`; resolve fila por **nome** |
| `criar_fluxo` | Gatilho por termos + passos ordenados (`responder`, `menu`, `enfileirar`, `encerrar`) |
| `listar_fluxos` | Fluxos com seus passos |

Integrações/relatórios/LGPD (`src/mcp/tools.ts`):

| Tool | O que faz |
| --- | --- |
| `criar_webhook` | Endpoint de saída; segredo HMAC uma vez |
| `criar_chave_api` | Emite chave; o segredo volta uma vez |
| `metricas_qualidade` | TME/TMA/CSAT por grupo, numa janela ISO |
| `registrar_consentimento` | Consentimento LGPD por finalidade |
| `exportar_contato` | Portabilidade (art. 18, V) |
| `excluir_contato` | Eliminação (art. 18, VI) + trilha |

`criar_regra_bot` e `criar_fluxo` aceitam `queueName` em vez de `queueId`:
o agente não precisa conhecer ids internos, e a fila citada é criada se não
existir (`resolveQueueId` em `src/mcp/helpers.ts`).

Erro de tool volta como `isError: true` com a mensagem, **não** derruba a
sessão — é o que deixa o agente ler o erro e corrigir a chamada.

### Fluxos

`flows` + `flow_steps`. Um fluxo casa quando algum termo aparece no texto
(substring, como as regras do bot) e executa os passos em ordem.

Ordem de precedência no intake (`src/bot/engine.ts`):

1. atendente já atribuído → bot quieto (F3);
2. fora do horário → ausência + fila padrão (F3);
3. menu pendente na sessão (F3);
4. **regras do bot** (F3);
5. **fluxos** (F5) — só se nenhuma regra casou;
6. IA híbrida (F4) — último recurso.

Ou seja: um fluxo nunca rouba a resposta de uma regra mais específica. O
primeiro fluxo que casa (em ordem de criação) executa; o resto é ignorado.

## Webhooks de saída

Endpoint registra URL + eventos (`["*"]` = todos) e um segredo HMAC. O
segredo é devolvido só na criação.

Entrega assinada, formato GitHub:

```
X-AgentsRoom-Event: <evento>
X-AgentsRoom-Delivery: <id>
X-AgentsRoom-Timestamp: <unix>
X-AgentsRoom-Signature: sha256=<hex de HMAC("<timestamp>.<corpo>")>
```

Verificação no receptor: comparar `sha256` com HMAC-SHA256 do segredo sobre
`timestamp + "." + corpo`. Rejeitar timestamp muito antigo evita replay.

**Espelhamento automático**: `RealtimeHub.subscribeAll` (sala `ws:*`) recebe
todo evento publicado, e cada evento vira uma entrega para os endpoints
inscritos (`src/webhooks/dispatcher.ts`, `bridgeEventsToWebhooks` no
`app.ts`). É o que faz "criar um webhook" significar algo sem instrumentar
rota por rota.

Retry: backoff exponencial (`WEBHOOK_BASE_DELAY_MS` dobrando até
`WEBHOOK_MAX_DELAY_MS`), até `WEBHOOK_MAX_ATTEMPTS`; depois disso a entrega
fica `falhou` e para de ser reprocessada. O ticker é
`startWebhookTicker` no `server.ts`, a cada `WEBHOOK_TICK_MS`.

## Relatórios

`GET /workspaces/:id/reports/quality?groupBy=assignee|queue|channel|all&from=&to=&tmeAlvoSeg=`
e o mesmo em `.csv`.

Agregação em `src/reports/quality.ts`, sobre as mesmas amostras do SLA da F3
(`queue_tickets.first_response_at`/`resolved_at`) mais as notas 1..5 de
`conversation_ratings`:

- **TME** — `enqueued_at → first_response_at`; médio e mediana.
- **TMA** — `first_response_at → resolved_at`; médio e mediana.
- **CSAT** — média das notas e número de respostas.
- **slaTmePct** — % de tickets dentro da meta, só quando `tmeAlvoSeg` vem.
- **resolucaoPct** — % de tickets resolvidos na janela.

Nota: `PUT .../inbox/conversations/:id/rating` grava uma nota por conversa
(`UNIQUE (workspace_id, conversation_id)`); repetir sobrescreve.

## LGPD

| Endpoint | Artigo | Quem pode |
| --- | --- | --- |
| `GET/PUT /contacts/:id/consents` | art. 8º | qualquer membro |
| `GET /contacts/:id/export` | art. 18, V | qualquer membro |
| `DELETE /contacts/:id/data` | art. 18, VI | supervisor+ |
| `DELETE /workspaces/:id/data` | art. 18, VI | supervisor+ |
| `GET /lgpd/requests` | — | qualquer membro |

Consentimento por finalidade (`dados` \| `marketing` \| `ia`), com carimbo
de `granted_at`/`revoked_at`. A eliminação apaga conteúdo (conversas,
mensagens, notas, tickets, avaliações, canais, eventos) e **anonimiza** o
cadastro: nome vira `"Contato eliminado (LGPD)"`, telefone e e-mail vão a
null. A linha do contato sobrevive para a contagem histórica.

Toda solicitação fica em `lgpd_requests` (escopo, ação, resumo com as
contagens, quem pediu) — a trilha que prova o atendimento.

Backup é a outra face da LGPD: scripts em `coolify/resources/postgres/`
(`backup.sh`, `restore.sh`, `backup-volumes.sh`, `restore-volumes.sh`).
Restore é dry-run por padrão e exige `CONFIRM_RESTORE` igual ao nome do banco
alvo. Detalhes no README do recurso.

## Módulos extensíveis

`src/modules/registry.ts`: um módulo é `{ key, name, description, version,
routes?, mcpTools? }`. `buildApp` recebe a lista em
`BuildAppOptions.modules` (default: `F5_MODULES`) e registra rotas e tools.

Módulos da F5: `integracoes`, `relatorios`, `lgpd`, `automacao`. A chave de
cada um também existe em `workspace_modules`, para desligar uma capacidade por
workspace sem deploy.

## Testes

`tests/f5.test.ts` (24 casos) — inclui o critério de aceite principal:

> **agente externo cria fluxo via MCP**: o teste chama `criar_fila`,
> `criar_regra_bot` (com `queueName` "Comercial" e "Suporte") e `criar_fluxo`
> só por MCP, e verifica que as filas citadas nasceram, que o passo
> `enfileirar` guardou o `queueId` resolvido, e que o fluxo executa no intake
> na ordem.

Mais: conferência do relatório contra a base (TME 60s, TMA 120s, CSAT 5,
SLA 100%), isolamento entre workspaces (argumento conflitante ignorado,
escopo insuficiente recusado), entrega assinada com HMAC, backoff estourando
em `falhou`, segredo nunca exposto na listagem, consentimento/exclusão
LGPD com trilha, e módulo extra registrado traz rota e tool.

`tests/coolify.test.ts` — 2 casos novos: backup vai para o RustFS e o restore
é dry-run por padrão (o teste afirma o contrário do ingênuo: que aplicar
exige confirmação).

## Pendência

**O restore não foi validado em staging.** Não há conexão de servidor
disponível no ambiente, então o ensaio descrito no README do recurso
(`docs`: passo a passo de 5 etapas) ainda não rodou. É o único critério de
aceite em aberto — e ele não pode ser dado como cumprido até que alguém
execute o ensaio e registre o resultado.