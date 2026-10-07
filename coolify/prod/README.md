# Projeto `AgentsRoomCRM-prod` — produção (branch `main`)

- **Destination**: `coolify` (padrão do servidor). Nada deste projeto enxerga
  o staging: o projeto staging usa outra destination/rede.
- **Domínio público**: só o `core` (`core.exemplo.com`). Dashboards
  (WAHA) e console (RustFS) via túnel SSH quando precisar.
- Recursos: `core`, `postgres`, `redis`, `waha`, `storage`, `ollama`
  (guias em `coolify/resources/`).
- Credenciais: geradas pelo Coolify em cada recurso; `env.example` diz
  de-onde-para-onde copiar (Internal URLs). Nenhum segredo real no repo.
