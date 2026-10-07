# Recurso `ollama` — Service one-click, opcional (por ambiente)

Fonte: [Coolify Ollama](https://coolify.io/docs/services/ollama) — template
pronto no catálogo. GPU: editar o compose do recurso e adicionar reserva
`nvidia` (`deploy.resources.reservations.devices`).

## Criação (se o ambiente precisar de LLM local)

1. New Resource > Service > Ollama (one-click).
2. Sem domínio em F0 (só o core chama, pela rede interna em F1).
3. Baixar modelos pelo terminal do recurso:
   `OLLAMA_MODELS="llama3.1:8b" coolify/resources/ollama/pull-models.sh`.
   Vazio = serviço sobe sem modelo.
