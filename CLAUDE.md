<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# CLAUDE.md

Project context for Claude Code (and any other coding agent that
reads it). The maintainer's auto-memory at
`~/.claude/projects/-Users-wusheng-github-vantage-studio/memory/`
is also relevant — that's per-user, this file is per-repo.

## What this project is

Vantage Studio is a web admin for **Apache SkyWalking 10.5+**'s
`admin-server` module — runtime-rule hot-update for MAL / LAL /
OAL plus the SWIP-13 `/dsl-debugging/*` live debugger. It runs as
a single distroless container, talks to OAP on `:17128`
(admin-server) + `:12800` (query-graphql), and ships its own
auth + RBAC + capture-history layer.

## Repo layout

```
apps/
  bff/                Fastify BFF (Node 24). Auth, RBAC, audit log,
                      OAP proxying, debug session orchestration.
  ui/                 Vue 3 + TS + Vite SPA. Monaco editor for
                      MAL/LAL DSL, per-DSL live-debugger views,
                      capture-history page.
packages/
  api-client/         Wire types + thin HTTP clients shared by
                      BFF + UI. Mirrors OAP's SWIP-13 contracts.
  design-tokens/      CSS custom-property tokens + per-theme
                      palette generators.
deploy/docker/        Multi-stage Dockerfile + studio.yaml example.
docs/                 Operator-facing markdown (install / auth /
                      configure / docker / operator-workflows /
                      compatibility).
.github/workflows/
  ci.yml              Lint + typecheck + tests + per-commit image
                      build on every push to main.
  release.yml         Tag-triggered: image build, cosign keyless
                      sign, CycloneDX SBOM, GitHub release.
```

## OAP integration (essential to remember)

- Required SkyWalking version: **10.5.0+** (first OAP release with
  `admin-server`, runtime-rule receiver, `/runtime/oal/*`, and
  `/dsl-debugging/*`).
- Studio binds to:
  - `:17128` — admin-server (`/runtime/rule/*`, `/runtime/oal/*`,
    `/dsl-debugging/*`)
  - `:12800` — query-graphql (cluster status)
- All three SWIP-13 selectors default to **disabled** upstream;
  the OAP operator must opt in:
  ```
  SW_ADMIN_SERVER=default
  SW_RECEIVER_RUNTIME_RULE=default
  SW_RECEIVER_DSL_DEBUGGING=default
  ```
- The local checkout at `~/github/skywalking` is the source of
  truth for the wire shape. Branch `feature/runtime-rule-hot-update`
  + the `dsl-debugging-terminal-value-and-cap` branch carry the
  current recorder code; consult these when wire shapes are
  ambiguous (e.g. `MalOutputPayload.value` shape, IDManager id
  format, `SessionLimits` caps).

## Conventions

### Commit messages

- Style: `type(scope): subject` lower-case, present tense.
  Examples: `feat(debug-mal): …`, `fix(debug-lal): …`,
  `docs(release): …`, `ci: …`, `chore: …`.
- Body: explain *why*, not *what*. Reference upstream files /
  line numbers when applicable.
- **Do not add a `Co-Authored-By: Claude` trailer to commits.**
  The maintainer is the sole author of record on this repo.

### Workflow (this is a personal repo)

- Direct push to `main`. No PR-based workflow.
- Run before every commit:
  ```
  pnpm lint
  pnpm -F @vantage-studio/ui typecheck
  pnpm test
  pnpm format         # only when needed; CI doesn't auto-format
  ```
- All four must pass. CI re-runs them on every push.

### Image tagging (current policy)

- **Push to `main`** → one tag, the full commit SHA, no prefix
  (`ghcr.io/wu-sheng/vantage-studio:<40-char-commit-sha>`)
- **Push `v*.*.*` tag** → `:<X.Y.Z>` + `:latest`, cosign-signed,
  with CycloneDX SBOM attestation. Owned by `release.yml`; CI
  deliberately doesn't fire on tags to avoid double publishing.
- The commit SHA is also in OCI labels
  (`org.opencontainers.image.revision`) and the SLSA provenance
  attestation.

## Local dev loop

The standard live-test setup the maintainer uses:

```bash
# 1. Build the SPA (after every UI source change)
pnpm -F @vantage-studio/ui build

# 2. Build the BFF bundle (after every BFF source change)
pnpm -F @vantage-studio/bff build

# 3. Restart the local BFF process pointing at the SPA bundle.
#    `wildcard: false` on @fastify/static snapshots the dist tree
#    at startup, so a SPA rebuild ALWAYS needs a BFF restart.
pkill -9 -f 'apps/bff/dist/server.js'
STUDIO_CONFIG=/tmp/studio-local.yaml \
  STUDIO_UI_DIR=/Users/wusheng/github/vantage-studio/apps/ui/dist \
  NO_PROXY='localhost,127.0.0.1' no_proxy='localhost,127.0.0.1' \
  node /Users/wusheng/github/vantage-studio/apps/bff/dist/server.js \
  > /tmp/bff.log 2>&1 &
```

`NO_PROXY` is required because Clash on the maintainer's machine
intercepts localhost otherwise. After restart, the operator
hard-refreshes the browser (Cmd-Shift-R).

OAP runs locally on `:17128` (admin-server), bound by
`/tmp/studio-local.yaml`. Login is `admin` / `admin`.

## Key constants

- `@vantage-studio/api-client` exports `MAX_RECORD_CAP = 100` and
  `MAX_RETENTION_MILLIS = 3_600_000` — mirrors of OAP's
  `SessionLimits.java`. Single source of truth; the BFF validator
  and UI input bounds both import from here.
- `apps/ui/src/views/debug/constants.ts` re-exports the cap as
  `RECORD_CAP_MAX` plus UI-only knobs (`DEFAULT_RETENTION_MINUTES`,
  `MS_PER_MINUTE`).

## State of the project (as of v0.1.0)

- Live debugger (MAL / LAL / OAL) is the most-iterated surface;
  see commits since `cd74bb9` for the design history. Don't
  re-introduce the deleted `DebugSourcePane.vue` / `useRuleSource`
  / `sourceMatch.ts` chain — they were the legacy file-fetch +
  line-match path; the canonical surface is the per-DSL view's
  own in-grid foldable DSL pane (LAL especially, with line hooks).
- Capture history is browser-local only (`vs:debug-history:v1` in
  `localStorage`, capped 20 entries per widget). No server-side
  persistence; `useDebugHistory` is the singleton.
- LDAP / OIDC, restore-from-bundle, OAL hot-update, and rule
  history/diff/rollback are all intentionally **deferred**.

## Useful files when investigating

- Wire types: `packages/api-client/src/dsl-debugging.ts`
- BFF debug routes: `apps/bff/src/oap/debug-routes.ts`
- Per-DSL views: `apps/ui/src/views/debug/{DebugMal,DebugLal,DebugOal}.vue`
- Shell + slot contract: `apps/ui/src/views/debug/DebugView.vue`
- Capture history: `apps/ui/src/composables/useDebugHistory.ts` +
  `apps/ui/src/views/DebugHistoryPage.vue`
- IDManager decoder: `apps/ui/src/views/debug/oalEntityId.ts`
- Sidebar nav: `apps/ui/src/design/primitives/CatalogNav.vue`
