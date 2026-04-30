# Copyright 2026 The Vantage Studio Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# syntax=docker/dockerfile:1.7

# Multi-stage build:
#   1. builder: glibc-based Node 24 image installs deps, runs vite for the
#      SPA, runs esbuild for the BFF, then `pnpm deploy --prod --legacy`
#      produces a clean prod-only node_modules tree (carries argon2's
#      linux-x64 prebuild + pino's worker transport tree).
#      glibc (not alpine/musl) so the prebuild matches the distroless
#      runtime base.
#   2. runtime: distroless/nodejs24-debian12 — copies the BFF bundle,
#      the deploy/node_modules tree, the built SPA, and the example
#      config. No shell, no package manager, runs as the nonroot user.

# ── builder ────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

RUN corepack enable
WORKDIR /workspace

# Workspace + lock first for cache reuse on source-only edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY scripts ./scripts
COPY LICENSE-HEADER.txt ./
COPY apps/bff/package.json apps/bff/
COPY apps/ui/package.json apps/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/design-tokens/package.json packages/design-tokens/

RUN pnpm install --frozen-lockfile

# Source.
COPY apps/bff apps/bff
COPY apps/ui apps/ui
COPY packages packages
COPY eslint.config.js ./

# Build the SPA + bundle the BFF.
RUN pnpm -F @vantage-studio/ui build && \
    pnpm -F @vantage-studio/bff build

# Produce a clean prod-only deploy tree for the runtime stage. `--legacy`
# is required on pnpm 10+ for non-injected workspaces.
RUN pnpm deploy --filter @vantage-studio/bff --prod --legacy /deploy

# ── runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app

# BFF bundle + sourcemap.
COPY --from=builder /workspace/apps/bff/dist ./

# Production node_modules — carries argon2's linux-x64 prebuild and
# every transitive dep esbuild externalised (pino + its worker tree).
COPY --from=builder /deploy/node_modules ./node_modules

# SPA static bundle + first-run config seed.
COPY --from=builder /workspace/apps/ui/dist ./ui
COPY deploy/docker/studio.yaml.example ./studio.yaml.example

ENV NODE_ENV=production
ENV STUDIO_CONFIG=/data/studio.yaml
ENV STUDIO_CONFIG_EXAMPLE=/app/studio.yaml.example
ENV STUDIO_UI_DIR=/app/ui

EXPOSE 8080

# distroless's nodejs ENTRYPOINT is `node`; CMD becomes its args.
CMD ["/app/server.js"]
