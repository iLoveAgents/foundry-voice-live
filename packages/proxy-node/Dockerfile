# Build from the repository root:
# docker build -f packages/proxy-node/Dockerfile -t foundry-voice-live-proxy .
FROM node:26-alpine AS base

# Node 26 does not bundle Corepack. Keep this version aligned with packageManager.
RUN npm install --global pnpm@9.15.0
WORKDIR /app

# Preserve the workspace lockfile and root dependency overrides in every install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/proxy-node/package.json ./packages/proxy-node/package.json
COPY packages/react/package.json ./packages/react/package.json
COPY examples/package.json ./examples/package.json

FROM base AS builder
RUN pnpm --filter @iloveagents/foundry-voice-live-proxy-node install --frozen-lockfile
COPY packages/proxy-node/tsconfig.json packages/proxy-node/tsconfig.build.json ./packages/proxy-node/
COPY packages/proxy-node/src ./packages/proxy-node/src
RUN pnpm --filter @iloveagents/foundry-voice-live-proxy-node run build

FROM base AS production-dependencies
ENV NODE_ENV=production
RUN pnpm --filter @iloveagents/foundry-voice-live-proxy-node install --prod --frozen-lockfile --ignore-scripts

FROM node:26-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app
ENV NODE_ENV=production

# Keep pnpm's root store and package symlinks at their original relative paths.
COPY --from=production-dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=nodejs:nodejs /app/packages/proxy-node/package.json ./packages/proxy-node/package.json
COPY --from=production-dependencies --chown=nodejs:nodejs /app/packages/proxy-node/node_modules ./packages/proxy-node/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages/proxy-node/dist ./packages/proxy-node/dist

WORKDIR /app/packages/proxy-node
USER nodejs
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
CMD ["node", "dist/index.js"]
