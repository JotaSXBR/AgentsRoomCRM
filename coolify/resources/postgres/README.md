# Recurso `postgres` — Database gerenciado (por ambiente)

Fonte: [Coolify Databases](https://coolify.io/docs/databases) — container
standalone com credenciais geradas, volume persistente, healthcheck e
**backups agendados com upload S3**. É o motivo de ser recurso separado em
vez de serviço dentro de um compose: backup/restore viram operação de painel.

## Criação (no projeto do ambiente)

1. New Resource > Databases > PostgreSQL, imagem `postgres:17-alpine`
   (fixar a tag; nunca `latest`. Evitar 18: muda o path de dados padrão).
2. Initial database: `agentsroom`. Anotar a **Internal URL**
   (`postgres://...@<container>:5432/agentsroom`) — vai para o `core`.
3. Manter rede **privada** (sem port mapping, sem proxy público).
4. Backups > schedule diário, retenção 7 dias, com upload S3 para o `storage`
   do ambiente (quando o endpoint S3 estiver publicado; senão, local).
   **Testar um restore** antes de confiar (a doc do Coolify exige).
5. O role restrito `app_user` é criado pelo `migrate.js` do core usando
   `APP_DB_PASSWORD` — não criar usuário manual.

## Por que não um banco por serviço

Um servidor Postgres por ambiente, com databases separados por dono,
é a prática dos criadores (WAHA usa o mesmo padrão: um Postgres, database
por uso). Em F0 só existe `agentsroom`. Em F1, sessões do WAHA ganham o
database `waha` **no mesmo servidor** (`CREATE DATABASE waha`), sem novo
container — backup continua centralizado no recurso.
