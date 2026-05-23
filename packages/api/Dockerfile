# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1 — deps
#
# Hydrate the pnpm store and node_modules tree for the whole workspace. We
# resolve from the repo root so workspace links (api -> shared, web -> shared)
# work the same way they do in local dev.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy only the lockfile + package manifests first so this layer caches as long
# as dependencies haven't changed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2 — build
#
# Compile @ustow/shared, then build the NestJS API. We deliberately run the
# shared build first (the same `prebuild` hook documented in README.md), then
# `nest build` which writes to packages/api/dist/.
# -----------------------------------------------------------------------------
FROM deps AS build

WORKDIR /app

COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

RUN pnpm --filter @ustow/shared build \
 && pnpm --filter @ustow/api build

# -----------------------------------------------------------------------------
# Stage 3 — playwright
#
# Install the Chromium browser + Debian dependencies. We do this in a dedicated
# stage so the heavy apt install layer caches independently of the application
# code. The browser binary lives at /ms-playwright and is copied into the
# runtime image as a single COPY.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS playwright

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Playwright's CLI needs the package to be present to know which browser
# version to fetch — copy just the api package.json and install only that
# package's deps to keep the layer small.
COPY packages/api/package.json packages/api/

RUN cd packages/api \
 && pnpm install --prod=false playwright \
 && pnpm exec playwright install --with-deps chromium

# -----------------------------------------------------------------------------
# Stage 4 — runtime
#
# Production image. Ships compiled JS, production node_modules, and the
# Playwright browser binary. Runs as the unprivileged `node` user.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_HEADLESS=true

RUN corepack enable && corepack prepare pnpm@9 --activate

# Runtime libs Chromium needs at exec time — kept in sync with what
# `playwright install --with-deps chromium` pulled in the playwright stage.
# Listed explicitly so we don't carry the full apt cache + build-essential
# baggage that the install command would otherwise bring along.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace metadata (so `pnpm --filter @ustow/api ...` works inside the
# container — Railway's preDeployCommand uses it for migrations).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Built artifacts + production dependency tree from earlier stages.
COPY --from=build /app/node_modules                ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist        packages/shared/dist
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/api/package.json   packages/api/package.json
COPY --from=build /app/packages/api/tsconfig.json  packages/api/tsconfig.json
COPY --from=build /app/packages/api/nest-cli.json  packages/api/nest-cli.json
COPY --from=build /app/packages/api/drizzle.config.ts packages/api/drizzle.config.ts
COPY --from=build /app/packages/api/dist           packages/api/dist
COPY --from=build /app/packages/api/node_modules   packages/api/node_modules
# Migration SQL + tsx-runnable scripts (migrate.ts, seeds) are needed at
# runtime so the preDeployCommand can apply migrations.
COPY --from=build /app/packages/api/src/db         packages/api/src/db

# Playwright Chromium and its on-disk runtime files.
COPY --from=playwright /ms-playwright              /ms-playwright

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3001}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/api/dist/main.js"]
