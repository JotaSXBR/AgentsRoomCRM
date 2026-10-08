# F4 — IA híbrida BYOK + Ollama + RAG + fallback humano

## Visão geral

- **Orquestração híbrida** (`src/ai/orchestrate.ts`): regras da F3 primeiro;
  sem regra casada, a IA assume (`runBotOnIncoming(..., ai)`). Regra de
  palavra-chave/menu/triagem sempre tem prioridade sobre a IA.
- **RAG por workspace**: fontes `faq | documento | url` em
  `ai_knowledge_sources`, fatiadas em `ai_knowledge_chunks` (chunking
  determinístico por parágrafos, `src/ai/chunking.ts`). Recuperação por
  sobreposição léxica de termos (`src/ai/retrieve.ts`, sem dependência
  externa — determinístico nos testes). Resposta cita a fonte
  (`\n\nFonte: <títulos>`) e o log guarda `sources[]`.
- **Providers por workspace** (`ai_providers`): `openai_compatible`
  (qualquer API `/chat/completions` com Bearer) ou `ollama` local
  (`/api/chat`, sem chave). Chave BYOK cifrada com AES-256-GCM
  (`encryptSecret`, mesma primitiva de Meta/mail) — a API expõe só
  `hasApiKey`, nunca o valor nem o cifrado.
- **Sem resposta → humano com contexto**: sem provider, sem chunk
  relevante, chave ilegível ou erro do provider — envia
  `fallback_message`, enfileira na fila padrão (uma vez por ticket
  aberto) e posta nota `sistema` com a pergunta para o atendente.
- **Logs e custos** (`ai_logs`): pergunta, resposta, fontes, prompt
  completo, `input/output_tokens`, `cost_usd` (quando o provider tem
  preço por MTok), `latency_ms`, `outcome ∈ respondido|fallback|erro`
  e `fallback_reason`. `GET .../ai/logs` para auditoria.
- **Config por workspace** (`ai_settings`): `enabled` (default off —
  IA nunca responde sem opt-in explícito), `systemPrompt`,
  `fallbackMessage`, `maxChunks`.

## Rotas novas

| Método | Rota | Papel mínimo |
| --- | --- | --- |
| GET/PUT | `/workspaces/:id/ai/settings` | membro / supervisor+ |
| GET/PUT/DELETE | `/workspaces/:id/ai/provider` | membro / supervisor+ |
| GET/POST | `/workspaces/:id/ai/sources` | membro / supervisor+ |
| PATCH/DELETE | `/workspaces/:id/ai/sources/:sourceId` | supervisor+ |
| POST | `/workspaces/:id/ai/sources/:sourceId/sync` | supervisor+ (só `url`: baixa HTML, extrai texto) |
| GET | `/workspaces/:id/ai/logs` | membro |

## Banco

`migrations/006_f4.sql`: `ai_settings`, `ai_providers`,
`ai_knowledge_sources`, `ai_knowledge_chunks`, `ai_logs` — todas com
RLS FORÇADO e policy tenant por `app.current_workspace_id`.
Store: slice `stores/types/ai.ts` + `stores/memory/ai.ts`
(`createAiMaps` agrupa os 5 mapas para o orçamento de linhas do
`MemoryStore`) + `stores/postgres/ai.ts` (+ mappers em
`stores/postgres/rowsAi.ts`).

## Efeito no intake

`runBotOnIncoming` ganhou 4º parâmetro opcional `ai: AiDeps`
(`{ chatCaller?, secretsKey }`). Widget, webhooks WAHA/Meta e sync
IMAP repassam; `server.ts` injeta `{ secretsKey: jwtSecret }` e o
caller real (`fetch`). Testes injetam `chatCaller` fake via
`buildApp({ ai: { chatCaller } })`.
