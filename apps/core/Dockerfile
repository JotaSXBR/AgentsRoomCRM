# F0 — imagem do core (apps/core). Build a partir da RAIZ do monorepo:
#   docker build -f apps/core/Dockerfile .
# O push na main rebuilda SÓ esta imagem (ver .github/workflows/cd-core.yml).

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/core/package.json apps/core/package.json
RUN npm ci --workspaces --include-workspace-root

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY tsconfig.base.json ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/core ./apps/core
# Ordem topológica explícita: shared -> db -> core
RUN npm run build --workspace=@agentsroom/shared \
 && npm run build --workspace=@agentsroom/db \
 && npm run build --workspace=@agentsroom/core

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --create-home --uid 1001 app && chown -R app:app /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/apps/core/dist ./apps/core/dist
COPY --from=build /app/apps/core/package.json ./apps/core/package.json
COPY --from=build /app/apps/core/migrations ./apps/core/migrations
COPY --from=build /app/apps/core/public ./apps/core/public
COPY --from=build --chmod=755 /app/apps/core/docker-entrypoint.sh ./apps/core/docker-entrypoint.sh
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Entrypoint = migrate (se postgres) + server. Sem CMD: o entrypoint decide.
ENTRYPOINT ["/app/apps/core/docker-entrypoint.sh"]
