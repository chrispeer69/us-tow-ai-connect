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
# Stage 3 — runtime
#
# Use Microsoft's official Playwright image as the runtime base. It ships
# with Chromium (and headless_shell, the variant Playwright >=1.49 prefers)
# pre-installed at the exact path the matching Playwright npm version
# expects. Pin the tag to the same minor as the workspace lockfile —
# package.json has "playwright": "^1.43.0" but the resolved version in
# pnpm-lock.yaml is 1.60.0, so we pin v1.60.0-jammy here. When the lockfile
# bumps, bump this tag in the same PR.
#
# The official image already ships node + corepack + libraries, so this
# stage doesn't need its own apt install + Playwright install dance.
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_HEADLESS=true

# Corepack is included in the official Playwright image but pnpm@9 needs to
# be activated explicitly so the migration preDeployCommand can run.
RUN corepack enable && corepack prepare pnpm@9 --activate

# Tini is not in the playwright image by default; we install it as the
# init shim for clean signal handling.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace metadata (so `pnpm --filter @ustow/api ...` works inside the
# container — Railway's preDeployCommand uses it for migrations).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Built artifacts + production dependency tree from the build stage.
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

# Belt-and-suspenders: even though the base image (v1.60.0-jammy) is pinned
# to the resolved playwright npm version, drift between the image's baked
# Chromium build and the one playwright npm expects has bitten us before
# (e.g. ERROR [SessionManagerService] browser launch: Executable doesn't
# exist at /ms-playwright/chromium_headless_shell-...). Re-running the
# install against the workspace's playwright npm guarantees the headless
# shell binary lands at the exact path SessionManagerService asks for.
RUN npx playwright install --with-deps chromium

# The official Playwright image is set up as root by default; switch to
# the unprivileged 'pwuser' it creates for production runs. (Don't try to
# switch to 'node' — that user does not exist in this base image.)
USER pwuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3001}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
# Belt-and-suspenders against the railway.toml/preDeployCommand mismatch that
# caused production tables to be missing on 2026-05-23: always apply
# drizzle migrations before booting the server. The migrator is idempotent
# (writes to __drizzle_migrations) so re-running on every container start is
# safe and cheap.
CMD ["sh", "-c", "node packages/api/dist/db/migrate.js && node packages/api/dist/main.js"]
