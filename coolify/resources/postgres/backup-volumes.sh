#!/usr/bin/env bash
# Backup dos volumes Docker do ambiente (F5) -> RustFS.
#
# Complementa o dump do Postgres (`../postgres/backup.sh`): o banco guarda as
# conversas, mas a sessão do WhatsApp (WAHA) e qualquer mídia local vivem em
# volume. Sem isto, um restore bem-sucedido devolve um CRM sem sessão ativa —
# o usuário precisa reautenticar o número.
#
# Uso (no host com docker):
#   RUSTFS_URL=http://rustfs:9000 RUSTFS_ACCESS_KEY=... RUSTFS_SECRET_KEY=... \
#   VOLUMES="waha-prod_waha-data" ./backup-volumes.sh
#
# O nome do volume é o que o Docker cria a partir do projeto + serviço
# (`<projeto>_<stack>_<volume>`). Liste os volumes desejados em VOLUMES.
set -euo pipefail

: "${RUSTFS_ACCESS_KEY:?defina RUSTFS_ACCESS_KEY do ambiente}"
: "${RUSTFS_SECRET_KEY:?defina RUSTFS_SECRET_KEY do ambiente}"
: "${VOLUMES:?defina VOLUMES com os nomes dos volumes (separados por espaço)}"

RUSTFS_URL="${RUSTFS_URL:-http://localhost:9000}"
BACKUP_BUCKET="${BACKUP_BUCKET:-crm-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-volumes}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
ALIAS="${MC_ALIAS:-agentsroom}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

log() { printf '[backup-volumes] %s\n' "$*" >&2; }

command -v docker >/dev/null || { log "ERRO: docker não encontrado"; exit 1; }
mc alias set "${ALIAS}" "${RUSTFS_URL}" "${RUSTFS_ACCESS_KEY}" "${RUSTFS_SECRET_KEY}" >/dev/null

for volume in ${VOLUMES}; do
  docker volume inspect "${volume}" >/dev/null 2>&1 \
    || { log "ERRO: volume '${volume}' não existe neste host"; exit 1; }

  ARCHIVE="${WORK_DIR}/${volume}-${STAMP}.tar.gz"
  log "empacotando ${volume}"
  # `tar` sobre o ponto de montagem: não depende de caminho estável no host e
  # não inclui o próprio arquivo de saída (ele nasce depois).
  MOUNT="$(docker volume inspect "${volume}" --format '{{ .Mountpoint }}')"
  tar -C "${MOUNT}" -czf "${ARCHIVE}" .

  REMOTE_DIR="${ALIAS}/${BACKUP_BUCKET}/${BACKUP_PREFIX}/${STAMP}"
  mc cp "${ARCHIVE}" "${REMOTE_DIR}/" >/dev/null
  log "enviado: s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${STAMP}/$(basename "${ARCHIVE}")"
done

log "removendo volumes com mais de ${BACKUP_RETENTION_DAYS} dias"
mc find "${ALIAS}/${BACKUP_BUCKET}/${BACKUP_PREFIX}" --older-than "${BACKUP_RETENTION_DAYS}d" \
  --exec 'mc rm {}' >/dev/null 2>&1 || log "nada a remover"

log "backup de volumes OK"