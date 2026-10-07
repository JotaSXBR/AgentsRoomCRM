# Recurso `waha` — Service, engine GOWS (por ambiente)

Fontes: [WAHA engines](https://waha.devlike.pro/docs/engines/gows/) e
[Coolify Services](https://coolify.io/docs/services) — o WAHA roda como stack
própria; GOWS é o engine Go sem browser (deploy oficial
`devlikeapro/waha:gows` + `WHATSAPP_DEFAULT_ENGINE=GOWS`).

## Criação (no projeto do ambiente)

1. New Resource > Service > Docker Compose Empty. Colar
   `coolify/resources/waha/compose.yml`.
2. Preencher `WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME`,
   `WAHA_DASHBOARD_PASSWORD` (valores do `env.example` do projeto).
   `health,ping` ficam fora da exigência de API key para o healthcheck.
3. Ativar **Connect To Predefined Network** (o Service usa rede própria por
   padrão; sem isso o core não alcança o WAHA pela rede do projeto em F1).
   Os criadores do Coolify avisam: projeto/ambiente **não** é fronteira de
   rede — o que conecta é a rede Docker compartilhada.
4. **Sem domínio**: o dashboard (`/dashboard`, porta `3000`) é acessado via
   túnel SSH quando precisar ler o QR. Só o `core` é público.
5. Criar a sessão: `coolify/resources/waha/bootstrap.sh`
   (`WAHA_URL=http://localhost:3000` pelo túnel, envia `X-Api-Key` se definida).

## F1 (documentado, não em F0)

- Sessões em Postgres: `WHATSAPP_SESSIONS_POSTGRESQL_URL` apontando para o
  database `waha` no `postgres` do ambiente (mesmo servidor, database novo).
- Mídia em S3: `WAHA_MEDIA_STORAGE=S3` + `WAHA_S3_*` contra o `storage`
  (path-style, como a doc do WAHA exige para S3-compatíveis).
- Webhook → `POST /webhooks/waha` do core (endpoint ainda não existe).
