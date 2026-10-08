# AGENTS.md — AgentsRoomCRM

Monorepo npm workspaces: `apps/core` (API Fastify), `packages/shared` (papéis/RBAC/tipos), `packages/db` (tenant/RLS).

## Comandos (sempre da raiz)

```bash
npm run typecheck   # tsc --noEmit nos 3 workspaces
npm run test        # vitest nos 3 workspaces (~150 testes, <10s)
npm run lint        # eslint; 0 erros hoje, 11 warnings conhecidos
npm run dev:core    # API com STORE_DRIVER=memory (dev/teste)
npm run build --workspace=@agentsroom/core
```

Smoke test: subir e testar **na mesma chamada** (sessões de shell não persistem background entre chamadas):
`PORT=3459 STORE_DRIVER=memory JWT_SECRET=qualquer-coisa node dist/server.js` + `curl /health /ready`.

## Onde fica o quê (`apps/core/src`)

`routes/` (HTTP) · `bot/engine.ts` (precedência: atribuído > horário > menu > regra F3 > fluxo F5 > IA F4) · `stores/` (interface `Store`; `memory/` dev/teste, `postgres/` por domínio) · `stores/types/` (um arquivo por domínio) · `mcp/` (JSON-RPC na mão, sem SDK) · `migrations/00N_*.sql` (RLS `FORCE ROW LEVEL SECURITY` — escrever exatamente assim, o teste trava a regex).

## Regras que evitam retrabalho

- Isolamento em 2 camadas: `requireWorkspace` no app (403/401) + RLS forçado no banco. Todo evento realtime carrega `workspaceId`; cliente só recebe a sua room.
- `workspaceId` em tools MCP é **injetado pelo servidor** a partir da chave — nunca aceitar o enviado pelo agente.
- Segredos (BYOK, tokens Meta, senhas IMAP) cifrados com AES-256-GCM; API nunca devolve `*_enc`; chave de API (`ark_live_*`) e segredo de webhook voltam **uma vez**.
- `return store.x()` sem `await` dentro de `try/catch` escapa do catch — `await` obrigatório.
- Novo tipo de evento realtime exige entrada na união `kind` de `realtime/hub.ts`.
- `tsc` passando não basta: import faltando só aparece em runtime — rodar a suite inteira, não só o arquivo novo.
- PowerShell: nunca montar JSON com curl escapado na mão (`ConvertTo-Json` ou arquivo); `Set-Content` corrompe acentos em arquivos grandes — usar a ferramenta de escrita do CLI.
- Porta 3000 costuma estar ocupada localmente — usar 345x nos testes manuais.

## Limites

- Não tocar em `.agentsroom/` (estado do app), `.mcp.json`, `dist/`, `node_modules/`.
- `tests/*.test.ts` grandes (f2b, f3, f5 >350 linhas) geram warning — dividir por domínio ao criar novos.
- Complexidade máxima 12, `max-params` 4 (warnings atuais em `bot/engine.ts`, `config.ts`, `mcp/helpers.ts`, `modules/flows.ts`, `webhooks/dispatcher.ts`).
- `coolify/*.env.example` guarda **origens**, nunca valores reais (há teste que trava isso).
