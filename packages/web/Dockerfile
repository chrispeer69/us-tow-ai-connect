# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1 — deps
# Hydrate the workspace lockfile-based install once so it caches between
# rebuilds when only source files change.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2 — build
# Compile @ustow/shared then `next build` with output: 'standalone' enabled
# in next.config.js. This drops a self-contained server at
# packages/web/.next/standalone with only the deps it actually uses.
# -----------------------------------------------------------------------------
FROM deps AS build

WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEFAULT_TENANT_ID
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_DEFAULT_TENANT_ID=${NEXT_PUBLIC_DEFAULT_TENANT_ID}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}

COPY packages/shared/ packages/shared/
COPY packages/web/    packages/web/

RUN pnpm --filter @ustow/shared build \
 && pnpm --filter @ustow/web build

# -----------------------------------------------------------------------------
# Stage 3 — runtime
# Smallest possible image: just the standalone bundle, static assets, and
# the public/ tree. No pnpm, no source.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# tini → clean PID-1 signal handling so Railway's SIGTERM actually stops the
# Next.js server instead of leaking child processes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Standalone bundle bundles its own node_modules + server.js. Public assets
# and built static chunks need to live alongside it at the same relative
# paths Next.js expects.
COPY --from=build /app/packages/web/.next/standalone        ./
COPY --from=build /app/packages/web/.next/static            ./packages/web/.next/static
# If public/ exists, copy it in. (The image build won't fail when the dir is
# absent because the COPY of standalone above guarantees the parent path.)
COPY --from=build /app/packages/web/public                  ./packages/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/web/server.js"]
