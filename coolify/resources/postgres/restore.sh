#!/usr/bin/env bash
# Restore de um dump do Postgres vindo do RustFS (F5).
#
# AVISO: este script SUBSTITUI o conteúdo do banco alvo. Ele existe para
# dois cenários, e o segundo é o que valida a F5:
#   1. recuperação de incidente (prod caiu; restaurar a última noite boa);
#   2. validação de restore em staging (restaurar o dump de PROD em STAGING
#      e conferir contagens) — o ensaio que prova que o backup serve para algo.
#
# O script NÃO conecta sozinho: ele despeja em STDOUT quando BACKUP_TO_STDOUT=1.
# Rodar direto no banco é decisão consciente de quem executa (evita que um
# restore acidental a partir de um LLM/script apague produção).
#
# Dry-run (padrão, seguro): baixa o dump, valida e mostra o que seria feito.
#   BACKUP_FILE=s3://crm-backups/agentsroom/20260101T000000Z/agentsroom-....sql.gz ./restore.sh
# Aplicação real (exige confirmação explícita):
#   APPLY=1 CONFIRM_RESTORE=agentsroom_staging ./restore.sh
set -euo pipefail

: "${RUSTFS_ACCESS_KEY:?defina RUSTFS_ACCESS_KEY do ambiente}"
: "${RUSTFS_SECRET_KEY:?defina RUSTFS_SECRET_KEY do ambiente}"
: "${BACKUP_FILE:?informe BACKUP_FILE (s3://bucket/prefix/dia/arquivo.sql.gz)}"

RUSTFS_URL="${RUSTFS_URL:-http://localhost:9000}"
BACKUP_BUCKET="${BACKUP_BUCKET:-crm-backups}"
ALIAS="${MC_ALIAS:-agentsroom}"
APPLY="${APPLY:-0}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-}"

log() { printf '[restore] %s\n' "$*" >&2; }
fail() { log "ERRO: $*"; exit 1; }

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
LOCAL_DUMP="${WORK_DIR}/dump.sql.gz"

mc alias set "${ALIAS}" "${RUSTFS_URL}" "${RUSTFS_ACCESS_KEY}" "${RUSTFS_SECRET_KEY}" >/dev/null

# Aceita tanto o caminho completo quanto "prefixo/dia/arquivo".
if [[ "${BACKUP_FILE}" == s3://* ]]; then
  REMOTE="${ALIAS}/${BACKUP_FILE#s3://}"
else
  REMOTE="${ALIAS}/${BACKUP_BUCKET}/${BACKUP_FILE}"
fi

log "baixando ${REMOTE}"
mc cp "${REMOTE}" "${LOCAL_DUMP}" >/dev/null
fail "download vazio" [[ -s "${LOCAL_DUMP}" ]]

# O dump corrompido é o modo de falha que aF5 precisa pegar ANTES de tocar
# no banco: por isso a verificação vem antes de qualquer escrita.
gzip -t "${LOCAL_DUMP}" || fail "arquivo corrompido (gzip inválido)"
gunzip -c "${LOCAL_DUMP}" > "${WORK_DIR}/dump.sql"
grep -q "^-- PostgreSQL database dump" "${WORK_DIR}/dump.sql" \
  || grep -qi "CREATE TABLE\|COPY " "${WORK_DIR}/dump.sql" \
  || fail "não parece um dump do pg_dump"

TABLES="$(grep -ci "^CREATE TABLE" "${WORK_DIR}/dump.sql" || true)"
ROWS="$(grep -ci "^COPY " "${WORK_DIR}/dump.sql" || true)"
log "dump íntegro: ${TABLES} CREATE TABLE, ${ROWS} blocos COPY"

if [[ "${APPLY}" != "1" ]]; then
  log "dry-run. Nada foi escrito no banco."
  log "para aplicar de fato: APPLY=1 CONFIRM_RESTORE=<nome-do-banco-alvo> ${0}"
  log "destino pretendido: ${PGDATABASE:-<não definido>}"
  exit 0
fi

# Confirmação explícita: ela precisa bater com o banco alvo, para que "aplicar
# em staging" nunca vire "aplicar em produção" por engano de variável.
: "${PGDATABASE:?defina PGDATABASE (o banco alvo)}"
[[ -n "${CONFIRM_RESTORE}" ]] || fail "APPLY=1 exige CONFIRM_RESTORE=<nome exato do banco alvo>"
[[ "${CONFIRM_RESTORE}" == "${PGDATABASE}" ]] \
  || fail "CONFIRM_RESTORE='${CONFIRM_RESTORE}' != PGDATABASE='${PGDATABASE}'"

log "aplicando em ${PGDATABASE} (isso apaga o conteúdo existente)"
psql -v ON_ERROR_STOP=1 --dbname="${PGDATABASE}" --file="${WORK_DIR}/dump.sql" >/dev/null

log "conferindo o resultado"
psql --dbname="${PGDATABASE}" --tuples-only --no-align \
  --command="SELECT 'workspaces=' || count(*) FROM workspaces;" || \
  log "aviso: tabela 'workspaces' não encontrada (dump de um schema diferente?)"
log "restore concluído em ${PGDATABASE}"