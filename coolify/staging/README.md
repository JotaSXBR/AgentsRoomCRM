# Projeto `AgentsRoomCRM-staging` — homologação (branch `staging`)

- **Destination separada**: criar uma destination nova no servidor (rede
  Docker `coolify-staging`) e usar em TODOS os recursos deste projeto.
  É o que garante **zero contato de rede** com a produção, mesmo na
  mesma VPS (projeto/ambiente não é fronteira de rede — rede Docker é).
- **Domínio público**: só o `core` (`core-staging.exemplo.com`).
- Recursos espelhados da prod, com valores próprios (nunca copiar segredo
  da prod). Guias em `coolify/resources/`.
