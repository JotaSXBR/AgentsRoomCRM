#!/bin/sh
# Entrypoint do core (F0): migrações automáticas + servidor.
# - STORE_DRIVER=postgres → roda `migrate.js` (idempotente via schema_migrations)
#   antes de subir. Single-instance por ambiente em F0; com 2+ réplicas, extrair
#   o migrate para job separado (F1) para evitar corrida.
# - qualquer outro driver → sobe direto (dev/teste em memória).
set -e

if [ "${STORE_DRIVER:-memory}" = "postgres" ]; then
  echo "[entrypoint] STORE_DRIVER=postgres — rodando migrations..."
  node apps/core/dist/migrate.js
fi

echo "[entrypoint] iniciando core..."
exec node apps/core/dist/server.js
