# Recurso `core` — Application (por ambiente)

Fonte: [Coolify Applications](https://coolify.io/docs/applications) — deploy a
partir do repositório; rede privada com os demais recursos do ambiente.

## Criação (no projeto do ambiente: `AgentsRoomCRM-prod` ou `-staging`)

1. New Resource > Applications > Dockerfile (repositório do projeto).
2. Branch: `main` (production) ou `staging` (staging).
3. Build: Dockerfile `apps/core/Dockerfile`, contexto = raiz do repo.
   Push na `main` rebuilda só esta imagem (workflow `cd-core.yml`).
4. Porta/alvo: `3000`. Healthcheck: `GET /health`.
5. Domínio público: `core.exemplo.com` (prod) / `core-staging.exemplo.com`
   (staging). Nada mais precisa de domínio neste recurso.
6. Escala: **1 réplica** em F0 (o entrypoint roda o migrate no boot; com 2+
   réplicas o migrate precisa virar job separado — F1).
7. Colar as variáveis da seção `core` do `env.example` do projeto
   (`coolify/<prod|staging>/env.example`).

## Migrations automáticas

O entrypoint (`apps/core/docker-entrypoint.sh`) roda `migrate.js` antes do
servidor quando `STORE_DRIVER=postgres`. É idempotente
(`schema_migrations`) e falha rápido sem `APP_DB_PASSWORD`, travando um
deploy com segredo faltando em vez de subir quebrado.

## Variáveis (origem)

| Var | Origem |
|---|---|
| `DATABASE_URL_MIGRATOR` | Internal URL do recurso `postgres` (usuário owner) |
| `DATABASE_URL` | mesma URL, trocando usuário/senha para `app_user`/`APP_DB_PASSWORD` |
| `REDIS_URL` | Internal URL do recurso `redis` (com senha) |
| `JWT_SECRET`, `OWNER_*` | gerados por ambiente, nunca reutilizados entre prod/staging |
