#!/usr/bin/env bash
# Baixa os modelos LLM do ambiente (Ollama é opcional, one-click do Coolify).
# Uso (no terminal do recurso ollama do ambiente):
#   OLLAMA_MODELS="llama3.1:8b" ./pull-models.sh
# Sem OLLAMA_MODELS, nada é baixado — o serviço sobe vazio.
set -euo pipefail

if [ -z "${OLLAMA_MODELS:-}" ]; then
  echo "OLLAMA_MODELS vazio — nenhum modelo para baixar."
  exit 0
fi

for modelo in ${OLLAMA_MODELS}; do
  echo "baixando ${modelo}..."
  ollama pull "${modelo}"
done
echo "modelos prontos: ${OLLAMA_MODELS}"
