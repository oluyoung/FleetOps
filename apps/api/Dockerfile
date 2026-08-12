# Build from the monorepo root:
#   docker build -f apps/api/Dockerfile -t fleetops-api .
#
# Multi-stage Turborepo build: prune the monorepo down to what apps/api
# actually needs (itself + @repo/contracts), install once, build once, then
# ship a slim runtime image with no dev dependencies or source files.

FROM node:22-alpine AS base

# --- Prune: compute the minimal workspace subset for apps/api ---
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.10.9
COPY . .
RUN turbo prune api --docker

# --- Install: dependencies for the pruned subset only ---
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci

# --- Build: bring in full pruned source, compile TypeScript ---
FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN npm run build --workspace=api

# --- Runtime: slim image, no dev deps, no source ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 fleetops \
  && adduser --system --uid 1001 fleetops
COPY --from=builder --chown=fleetops:fleetops /app .
USER fleetops
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
