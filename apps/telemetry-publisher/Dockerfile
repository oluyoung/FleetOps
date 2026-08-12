# Build from the monorepo root:
#   docker build -f apps/telemetry-publisher/Dockerfile -t fleetops-telemetry-publisher .
#
# Same turbo-prune pattern as apps/api/Dockerfile — see that file for
# rationale. telemetry-publisher has no workspace deps beyond itself.

FROM node:22-alpine AS base

FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@^2.10.9
COPY . .
RUN turbo prune telemetry-publisher --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN npm run build --workspace=telemetry-publisher

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 fleetops \
  && adduser --system --uid 1001 fleetops
COPY --from=builder --chown=fleetops:fleetops /app .
USER fleetops
CMD ["node", "apps/telemetry-publisher/dist/index.js"]
