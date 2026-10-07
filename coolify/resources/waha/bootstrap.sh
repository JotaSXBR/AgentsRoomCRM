#!/usr/bin/env bash
# Cria a sessão WhatsApp padrão no WAHA do ambiente (prod OU staging).
# Uso (qualquer máquina com acesso ao WAHA do ambiente):
#   WAHA_URL=https://waha.exemplo.com WAHA_API_KEY=... \
#   WAHA_DEFAULT_SESSION=padrao ./bootstrap.sh
# Webhook para o core é F1 (endpoint `POST /webhooks/waha` ainda não existe):
# este script NÃO configura webhook — só deixa a sessão pronta para o QR
# no dashboard.
set -euo pipefail

WAHA_URL="${WAHA_URL:-http://localhost:3000}"
SESSION="${WAHA_DEFAULT_SESSION:-padrao}"

AUTH_HEADER=()
if [ -n "${WAHA_API_KEY:-}" ]; then
  AUTH_HEADER=(-H "X-Api-Key: ${WAHA_API_KEY}")
fi

echo "criando sessão '${SESSION}' em ${WAHA_URL}..."
RESPONSE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${WAHA_URL}/api/sessions" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d "{\"name\":\"${SESSION}\",\"config\":{\"metadata\":{\"ambiente\":\"coolify\"}}}")"

if [ "${RESPONSE}" = "201" ] || [ "${RESPONSE}" = "200" ]; then
  echo "sessão '${SESSION}' criada — abra o dashboard do WAHA e leia o QR."
elif [ "${RESPONSE}" = "422" ]; then
  echo "sessão '${SESSION}' já existe — nada a fazer."
else
  echo "falha (HTTP ${RESPONSE}). Verifique WAHA_URL, WAHA_API_KEY e o serviço waha." >&2
  exit 1
fi
