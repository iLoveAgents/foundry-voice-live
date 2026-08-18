# Foundry Voice Live Proxy — production image.
#
# Built from the REPOSITORY ROOT so the pnpm workspace lockfile is available:
#
#   docker build -f packages/proxy-node/Dockerfile -t foundry-voice-live-proxy .
#
# pnpm itself is pinned by the root `packageManager` field via corepack, and dependencies
# are installed with --frozen-lockfile, so the image is reproducible.

# Stage 1: build the TypeScript sources
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

# Manifests first, so a source-only change reuses the dependency layer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/proxy-node/package.json packages/proxy-node/

RUN pnpm install --frozen-lockfile --filter @iloveagents/foundry-voice-live-proxy-node

COPY packages/proxy-node/ packages/proxy-node/

RUN pnpm --filter @iloveagents/foundry-voice-live-proxy-node run build

# Production dependencies + build output as a self-contained directory
RUN pnpm --filter @iloveagents/foundry-voice-live-proxy-node deploy --prod /app

# Stage 2: runtime (no pnpm, no build toolchain)
FROM node:22-alpine

RUN addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=nodejs:nodejs /app ./

USER nodejs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
