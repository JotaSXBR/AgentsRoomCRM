#!/usr/bin/env bash
# Restore de um volume Docker a partir do RustFS (F5). Ver ../postgres/restore.sh
# para a política (dry-run por padrão; exige confirmação explícita).
#
# Uso:
#   BACKUP_FILE=s3://crm-backups/volumes/20260101T000000Z/waha-data.tar.gz ./restore-volumes.sh
#   APPLY=1 CONFIRM_RESTORE=waha-data ./restore-volumes.sh
set -euo pipefail

: "${RUSTFS_ACCESS_KEY:?defina RUSTFS_ACCESS_KEY do ambiente}"
: "${RUSTFS_SECRET_KEY:?defina RUSTFS_SECRET_KEY do ambiente}"
: "${BACKUP_FILE:?informe BACKUP_FILE (s3://bucket/volumes/dia/volume.tar.gz)}"
: "${VOLUME:?informe VOLUME (nome do volume de destino)}"

RUSTFS_URL="${RUSTFS_URL:-http://localhost:9000}"
BACKUP_BUCKET="${BACKUP_BUCKET:-crm-backups}"
ALIAS="${MC_ALIAS:-agentsroom}"
APPLY="${APPLY:-0}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-}"

log() { printf '[restore-volume] %s\n' "$*" >&2; }
fail() { log "ERRO: $*"; exit 1; }

command -v docker >/dev/null || fail "docker não encontrado"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
ARCHIVE="${WORK_DIR}/volume.tar.gz"

mc alias set "${ALIAS}" "${RUSTFS_URL}" "${RUSTFS_ACCESS_KEY}" "${RUSTFS_SECRET_KEY}" >/dev/null
if [[ "${BACKUP_FILE}" == s3://* ]]; then
  REMOTE="${ALIAS}/${BACKUP_FILE#s3://}"
else
  REMOTE="${ALIAS}/${BACKUP_BUCKET}/${BACKUP_FILE}"
fi

log "baixando ${REMOTE}"
mc cp "${REMOTE}" "${ARCHIVE}" >/dev/null
fail "download vazio" [[ -s "${ARCHIVE}" ]]
gzip -t "${ARCHIVE}" || fail "arquivo corrompido (gzip inválido)"
tar -tzf "${ARCHIVE}" >/dev/null || fail "tarball inválido"
log "arquivo íntegro ($(tar -tzf "${ARCHIVE}" | wc -l) entradas)"

if [[ "${APPLY}" != "1" ]]; then
  log "dry-run. Destino pretendido: volume '${VOLUME}'"
  log "para aplicar: APPLY=1 CONFIRM_RESTORE=${VOLUME} ${0}"
  exit 0
fi

[[ "${CONFIRM_RESTORE}" == "${VOLUME}" ]] \
  || fail "CONFIRM_RESTORE='${CONFIRM_RESTORE}' != VOLUME='${VOLUME}'"

# Parar o serviço antes: restaurar por cima de um volume em uso deixa arquivos
# abertos em espaço inconsistente.
log "avisado: pare o serviço que usa '${VOLUME}' antes de continuar"
MOUNT="$(docker volume inspect "${VOLUME}" --format '{{ .Mountpoint }}')"
log "restaurando em ${MOUNT}"
tar -C "${MOUNT}" -xzf "${ARCHIVE}"
log "restore do volume concluído: ${VOLUME}"