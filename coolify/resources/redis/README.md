# Recurso `redis` — Database gerenciado (por ambiente)

Fonte: [Coolify Databases](https://coolify.io/docs/databases) — mesmo modelo
do postgres, com duas diferenças documentadas pelos criadores:

1. **Sem backup agendado** (limitação do engine no Coolify). A durabilidade
   vem da persistência AOF abaixo — perda aceitável em F0 porque o Redis
   guarda cache/filas/rate-limit, nunca fonte de verdade.
2. **Com senha**: definir password no recurso e usar a Internal URL com
   credencial no `REDIS_URL` do core.

## Criação (no projeto do ambiente)

1. New Resource > Databases > Redis. Definir senha.
2. Colar o conteúdo de `coolify/resources/redis/redis.conf` em
   "Custom Redis configuration" (`appendonly yes`, `maxmemory 256mb`,
   `maxmemory-policy noeviction` — nunca despejar silenciosamente).
3. Manter rede **privada**. Copiar a Internal URL para o `core`.
