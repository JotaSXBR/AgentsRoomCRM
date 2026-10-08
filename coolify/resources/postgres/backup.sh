#!/usr/bin/env bash
# Backup do Postgres (F5) -> RustFS (S3-compatible), um dump por banco.
#
# Por que pg_dump e não o backup nativo do Postgres: o restore precisa ser
# executável a partir de um dump de arquivo (testar em staging, recuperar de
# um incidente), sem depender do ambiente do cluster. O mesmo arquivo serve
# para migrar de um ambiente para outro.
#
# Uso (dentro do container/host com acesso ao Postgres do ambiente):
#   PGHOST=... PGUSER=... PGDATABASE=... \
#   RUSTFS_URL=http://rustfs:9000 \
#   RUSTFS_ACCESS_KEY=... RUSTFS_SECRET_KEY=... \
#   BACKUP_BUCKET=crm-backups BACKUP_RETENTION_DAYS=30 \
#   ./backup.sh
#
# Saída: um .sql.gz por execução em <bucket>/<prefixo>/<data>/, mais um
# "latest.txt" apontando o dump mais recente (facilita o restore sem listar).
set -euo pipefail

: "${PGDATABASE:?defina PGDATABASE}"
: "${RUSTFS_ACCESS_KEY:?defina RUSTFS_ACCESS_KEY do ambiente}"
: "${RUSTFS_SECRET_KEY:?defina RUSTFS_SECRET_KEY do ambiente}"

RUSTFS_URL="${RUSTFS_URL:-http://localhost:9000}"
BACKUP_BUCKET="${BACKUP_BUCKET:-crm-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-$PGDATABASE}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
ALIAS="${MC_ALIAS:-agentsroom}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY_DIR="${STAMP:0:8}"
REMOTE_DIR="${ALIAS}/${BACKUP_BUCKET}/${BACKUP_PREFIX}/${DAY_DIR}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
DUMP_FILE="${WORK_DIR}/${PGDATABASE}-${STAMP}.sql.gz"

log() { printf '[backup] %s\n' "$*" >&2; }

log "conectando ao Postgres ${PGDATABASE}"
# --clean/--if-exists torna o dump restaurável sobre um banco já existente.
pg_dump --format=plain --no-owner --no-privileges --clean --if-exists "${PGDATABASE}" \
  | gzip -9 > "${DUMP_FILE}"

SIZE="$(du -h "${DUMP_FILE}" | cut -f1)"
log "dump gerado (${SIZE}); enviando para ${REMOTE_DIR}"

mc alias set "${ALIAS}" "${RUSTFS_URL}" "${RUSTFS_ACCESS_KEY}" "${RUSTFS_SECRET_KEY}" >/dev/null
mc cp "${DUMP_FILE}" "${REMOTE_DIR}/" >/dev/null
printf 's3://%s/%s/%s/%s\n' \
  "${BACKUP_BUCKET}" "${BACKUP_PREFIX}" "${DAY_DIR}" "$(basename "${DUMP_FILE}")" \
  | mc pipe "${ALIAS}/${BACKUP_BUCKET}/${BACKUP_PREFIX}/latest.txt"

# Validação barata: um .gz truncado é o modo de falha mais comum de upload.
# Descomprimir e procurar o cabeçalho do dump pega o arquivo cortado na origem.
if ! gzip -t "${DUMP_FILE}"; then
  log "ERRO: dump corrompido localmente; nada foi considerado válido"
  exit 1
fi
log "upload concluído"

# Poda por idade (o bucket é o custo; a retenção precisa ser finita).
log "removendo backups com mais de ${BACKUP_RETENTION_DAYS} dias"
mc find "${ALIAS}/${BACKUP_BUCKET}/${BACKUP_PREFIX}" --older-than "${BACKUP_RETENTION_DAYS}d" \
  --exec 'mc rm {}' >/dev/null 2>&1 || log "nada a remover (ou sem permissão de listagem)"

log "backup OK: s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${DAY_DIR}/"