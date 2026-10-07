#!/usr/bin/env bash
# Cria os buckets S3 do ambiente no RustFS (prod OU staging — nunca misturar).
# Buckets (contrato com o core em F1, via S3_* do .env):
#   crm-midia    — anexos e mídia das conversas
#   crm-backups  — dumps e exports
# Uso: rode com `mc` instalado e ao alcance do RustFS do ambiente:
#   RUSTFS_URL=http://rustfs:9000 RUSTFS_ACCESS_KEY=... \
#   RUSTFS_SECRET_KEY=... ./bootstrap.sh
# Alternativa sem `mc`: criar os mesmos nomes pelo console web do RustFS.
set -euo pipefail

RUSTFS_URL="${RUSTFS_URL:-http://localhost:9000}"
: "${RUSTFS_ACCESS_KEY:?defina RUSTFS_ACCESS_KEY do ambiente}"
: "${RUSTFS_SECRET_KEY:?defina RUSTFS_SECRET_KEY do ambiente}"

mc alias set local "${RUSTFS_URL}" "${RUSTFS_ACCESS_KEY}" "${RUSTFS_SECRET_KEY}" >/dev/null
for bucket in crm-midia crm-backups; do
  if mc ls "local/${bucket}" >/dev/null 2>&1; then
    echo "bucket '${bucket}' já existe — nada a fazer."
  else
    mc mb "local/${bucket}"
    echo "bucket '${bucket}' criado."
  fi
done
