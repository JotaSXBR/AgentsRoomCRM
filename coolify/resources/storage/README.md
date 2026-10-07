# Recurso `storage` — Service RustFS S3-compatível (por ambiente)

Fontes: [RustFS Docker](https://docs.rustfs.com/installation/docker) e
[WAHA storages](https://waha.devlike.pro/docs/how-to/storages/). O MinIO saiu
do catálogo one-click do Coolify, então S3 próprio = Service com compose.
RustFS (Apache 2.0) é a escolha documentada aqui.

## Criação (no projeto do ambiente)

1. New Resource > Service > Docker Compose Empty. Colar
   `coolify/resources/storage/compose.yml`.
2. Preencher `RUSTFS_ACCESS_KEY` e `RUSTFS_SECRET_KEY` (nomes oficiais —
   **não** são `ROOT_USER/ROOT_PASSWORD`, esses são do MinIO). Nunca usar
   o padrão `rustfsadmin` em ambiente real.
3. Ativar **Connect To Predefined Network** (mesmo motivo do `waha`).
4. **Sem domínio**: o **console** (porta `9001`) é acessado via túnel SSH
   quando precisar criar buckets pelo navegador. A API S3 (`9000`) fica
   privada em F0.
5. Criar os buckets: `coolify/resources/storage/bootstrap.sh`
   (`crm-midia`, `crm-backups`).

## Notas dos criadores

- Health oficial: `GET /health/ready` (S3) — já no compose.
- Path-style é o padrão; clientes/SDKs devem forçá-lo (`force_path_style`).
- Não publicar a API S3 sob subpath (`/s3/`): quebra a assinatura SigV4.
- TLS antes de expor; backup do volume em F0, multi-node (MNMD) em F1.
