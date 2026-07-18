# Multi-stage, pnpm-workspace-aware build for @bookmark-ai/live-server.
# The build context is the REPO ROOT (see docker-compose.live.yml `context: ../..`)
# so the workspace graph resolves. `@bookmark-ai/types` ships raw TS and is bundled
# INTO dist/server.js by tsup (noExternal), so the runtime only needs the external
# npm deps that `pnpm deploy --prod` isolates.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- install (cached on manifests) + build ----
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY apps/live-server/package.json apps/live-server/
RUN pnpm install --frozen-lockfile --filter @bookmark-ai/live-server...

COPY packages/types packages/types
COPY apps/live-server apps/live-server
RUN pnpm --filter @bookmark-ai/live-server build
# Self-contained deployable (prod node_modules + package.json + built dist) at /app.
# --legacy: pnpm 10 otherwise refuses to deploy a non-injected workspace; we don't
# need injected deps because tsup already bundled @bookmark-ai/types into dist.
RUN pnpm --filter @bookmark-ai/live-server deploy --legacy --prod /app

# ---- slim runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# dist is copied from the build project (pnpm deploy honors .gitignore, which lists dist).
COPY --from=build /repo/apps/live-server/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
