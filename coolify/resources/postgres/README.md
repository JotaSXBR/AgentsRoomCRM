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

## Backup e restore da F5

O backup de painel do Coolify é a primeira camada. Os scripts aqui são a
segunda: eles produzem um **arquivo** (`pg_dump` comprimido + tar dos
volumes), que é o que permite testar restore em staging e migrar entre
ambientes.

| Script | O que faz |
| --- | --- |
| `backup.sh` | `pg_dump` do banco → `.sql.gz` no bucket `crm-backups` |
| `restore.sh` | Baixa e valida um dump; aplica só com confirmação explícita |
| `backup-volumes.sh` | Empacota volumes Docker (sessão do WAHA) → `.tar.gz` |
| `restore-volumes.sh` | Reposiciona um volume a partir do `.tar.gz` |

Dump diário (o `core` não roda isto; é cron do host ou job do Coolify):

```bash
PGHOST=<container-postgres> PGUSER=postgres PGDATABASE=agentsroom \
RUSTFS_URL=http://rustfs:9000 RUSTFS_ACCESS_KEY=... RUSTFS_SECRET_KEY=... \
BACKUP_BUCKET=crm-backups BACKUP_RETENTION_DAYS=30 \
./backup.sh
```

Variáveis relevantes: `BACKUP_RETENTION_DAYS` (poda por idade), `BACKUP_PREFIX`
(organiza por banco/ambiente), `VOLUMES` (lista de volumes em
`backup-volumes.sh`).

### Política de segurança dos scripts

- `restore.sh` e `restore-volumes.sh` são **dry-run por padrão**: baixam,
  validam e dizem o que fariam, sem escrever no banco.
- Aplicar exige `APPLY=1` **e** `CONFIRM_RESTORE` igual ao nome do banco (ou
  do volume) alvo. Um `llm`/CI rodar o script com a variável errada não
  apaga produção: a checagem compara os dois nomes.
- A validação vem antes de qualquer escrita: `gzip -t` e contagem de
  `CREATE TABLE`/`COPY` pegam o arquivo corrompido no caminho.

### Como validar de fato (ensaio de staging)

Backup só é confiável depois de um restore testado. O ensaio padrão da F5:

1. No **prod**, rode `backup.sh` e anote o caminho `s3://...`.
2. No **staging**, rode `restore.sh` sem `APPLY` (confere que baixa e valida).
3. Ainda em staging, aplique:
   ```bash
   PGDATABASE=agentsroom APPLY=1 CONFIRM_RESTORE=agentsroom \
   BACKUP_FILE=s3://crm-backups/agentsroom/<dia>/<arquivo>.sql.gz ./restore.sh
   ```
4. Suba o `core` do staging e confira: `/health`, login do dono, lista de
   conversas e um relatório de qualidade (números batem com o dump).
5. Registre data, caminho do dump e o resultado no diário do ambiente.

Sem o passo 5 o ensaio não conta como validação — é o registro que diz, meses
depois, se o backup é de um dia que ainda existe.

## Por que não um banco por serviço

Um servidor Postgres por ambiente, com databases separados por dono,
é a prática dos criadores (WAHA usa o mesmo padrão: um Postgres, database
por uso). Em F0 só existe `agentsroom`. Em F1, sessões do WAHA ganham o
database `waha` **no mesmo servidor** (`CREATE DATABASE waha`), sem novo
container — backup continua centralizado no recurso.