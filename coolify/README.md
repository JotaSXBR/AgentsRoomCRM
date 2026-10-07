# Coolify — Projetos `AgentsRoomCRM-prod` e `AgentsRoomCRM-staging` (F0)

**Mesma VPS, dois projetos, zero contato de rede entre prod e staging.**
Cada serviço é um recurso próprio (um app, um redis, um postgres…), como
recomendam os criadores: bancos como **Databases gerenciados** (o Coolify
gera as senhas e a Internal URL; backup/restore de painel),
apps Docker como **Applications**, e o resto como **Services** de compose.
Fontes: [Databases](https://coolify.io/docs/databases),
[Services](https://coolify.io/docs/services),
[networking](https://coolify.io/docs/core/networking-in-coolify),
[WAHA storages/engines](https://waha.devlike.pro/docs/how-to/storages/),
[RustFS Docker](https://docs.rustfs.com/installation/docker).

| Projeto | Branch | Destination/rede | Env |
|---|---|---|---|
| `AgentsRoomCRM-prod` | `main` | `coolify` (padrão) | `coolify/prod/env.example` |
| `AgentsRoomCRM-staging` | `staging` | `coolify-staging` (criar) | `coolify/staging/env.example` |

Detalhes por projeto em `coolify/<prod|staging>/README.md`;
guias por tipo de recurso em `coolify/resources/`.

## Mapa de recursos (criar em CADA projeto)

| Recurso | Tipo Coolify | Guia |
|---|---|---|
| `core` | Application (Dockerfile `apps/core/Dockerfile`) | `resources/core/` |
| `postgres` | Database PostgreSQL 17 | `resources/postgres/` |
| `redis` | Database Redis (com senha) | `resources/redis/` |
| `waha` | Service (compose `waha:gows`, sessões em volume local) | `resources/waha/` |
| `storage` | Service (compose RustFS) | `resources/storage/` |
| `ollama` | Service one-click (opcional) | `resources/ollama/` |

Desenvolvimento local (tudo de uma vez, fora do Coolify):
`docker compose -f coolify/local/docker-compose.yml up`.

## Por que separado e por que dois projetos

1. **Segredos nascem no Coolify**: Databases geram senhas e Internal URLs
   sozinhas; Services geram valores iniciais. O repo guarda só o mapa
   de-onde-para-onde (`<projeto>/env.example`), nunca o valor — compose
   separado com `.env` compartilhado versionado seria fria: divergiria do
   que o Coolify gerou na primeira divergência de senha.
2. **Rede é Docker network, não arquivo**: o que conecta dois recursos é
   compartilhar a rede; projeto/ambiente não é fronteira. Por isso o staging
   ganha destination/rede própria — sem ela, os dois projetos cairiam na
   mesma rede `coolify` do servidor.
3. **Ciclo de vida independente**: rebuildar o core não toca nos dados;
   trocar a tag do Postgres não recria o WAHA. O workflow `cd-core.yml`
   continua rebuildando só a imagem do core.
4. **Só o core é público**: dashboards/consoles via túnel SSH.

## Ordem de criação (por projeto)

1. Projeto + destination do projeto (staging: criar `coolify-staging`).
2. `postgres` → `redis` → `storage` → `waha` → `core` → `ollama` (se preciso),
   seguindo cada `resources/<nome>/README.md`.
3. No `core`: colar Internal URLs; o entrypoint roda o `migrate` sozinho no
   primeiro boot; seed do dono (`seed.js` ou primeiro `/auth/register`).
4. `storage/bootstrap.sh` (buckets), `waha/bootstrap.sh` (sessão + QR).
5. Checar `GET /health` e `GET /ready` do core.

## Limites F0 (vão para F1)

- Webhook `waha` → core (`POST /webhooks/waha` ainda não existe).
- Cliente S3 e chamadas ao Ollama no core (contrato `S3_*`/`WAHA_*`/`OLLAMA_*`
  já reservado no `.env.example`).
- Sessões do WAHA ficam em volume local (ir para Postgres só faria sentido
  por backup centralizado/multi-instância — sem motivo no momento).
- Réplicas do core > 1 exigem migrate fora do boot.

## Critérios de aceite F0

- Cada projeto tem os 6 recursos próprios, sem nada compartilhado
  (nem rede) entre prod e staging.
- Push na `main` rebuilda **só** o core.
- `tests/isolation.test.ts`: cross-workspace sem membership → **403**
  (401 sem token); `owner_global` passa.
- `tests/coolify.test.ts`: trava o contrato (recursos, composes, variáveis).
