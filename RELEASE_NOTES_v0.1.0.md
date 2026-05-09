# Vantage Studio v0.1.0

First public release. Web admin for Apache SkyWalking 10.5+'s
runtime-rule hot-update + DSL-debugging surfaces. Distroless
container, stateless BFF, browser-local debug history.

## Auth & RBAC
- Local accounts in `studio.yaml` with argon2id-hashed passwords;
  bring-your-own via the `vsadmin:hash` CLI.
- Default admin/admin on first run with a forced-rotation banner.
- Cookie-based session store (in-memory, `Secure` + `HttpOnly` +
  `SameSite=Strict`).
- Six RBAC verbs gating every BFF route: `rule:read`,
  `rule:write`, `rule:debug`, `rule:dump`,
  `rule:storage_change`, `rule:revert_bundled`.
- JSONL audit log for every state-changing request
  (`actor` / `verb` / `outcome` / `clientIp`).

## Catalog editor
- Three runtime-rule catalogs surfaced from the admin-server:
  `otel-rules`, `log-mal-rules`, `lal`. Plus a read-only `oal`
  catalogue for the bundled `.oal` source files.
- Sidebar grouped under **DSL Management**:
  `MAL · OTEL` / `MAL · Telegraf` / `LAL` / `LAL → MAL`
  (`log-mal-rules`, placed below LAL to reflect the data-flow
  direction) / `OAL · read-only`.
- Monaco YAML editor with bundled MAL / LAL DSL grammars and
  per-catalog autocomplete.
- Hot-update through `runtime/rule/{addOrUpdate, inactivate,
  delete}`; "filter-only edit" path detected and pushed without
  bumping the alarm window or triggering DDL.
- Bundled-vs-runtime side-by-side diff when an override exists.
- Search + status facets (active / inactive / bundled / modified)
  + "+ new rule" inline form with name validation.

## Live debugger (MAL · LAL · OAL)

Per-DSL views over OAP's SWIP-13 `/dsl-debugging/*` flow.

### Common
- Per-cluster install ack strip (`installed` / `already_installed`
  / `failed` / `timeout` per peer).
- Defaults match `SessionLimits.MAX_RECORD_CAP = 100` for both
  default and hard ceiling; 5 min retention default, 1 h hard
  cap. BFF rejects out-of-range with `400 invalid_recordCap`.
- Auto-save to browser-local capture history (see below).
- Deep-link from catalog rows + Monaco gutter glyphs.

### MAL
- Per-record card with rule-meta strip (`metric` / `filter` /
  `exp` / `suffix`).
- 3-column stage grid per step: `label · rail · rows-table`.
- Rows-table: `name | labels | value` (left-aligned, capped at 50
  rows + "+ N more").
- Click a step → its `sourceText` `<mark>`'d in the rule-meta
  strip above.
- Output meter renders only what the wire serialises: `metric`,
  `function`, `value` (when present — scalar `number`, `string`
  for non-finite, or `Record<string, number>` for histogram-
  percentile / `*Labeled`), `timeBucket`. Entity card collapses
  null fields with a `show all` toggle.
- Per-record fold/expand with subhead `fold all` / `expand all`.

### LAL
- Per-record × per-block matrix with sticky leftmost block-label
  column and sticky top record-header row.
- Statement-mode function rows split per `sourceLine` and carry
  the verbatim DSL slice (`tag stage: 'extractor'` …) as their
  name; block-mode collapses to one row labelled `extractor`.
- Search filter on log body / content / tags
  (case-insensitive); `show first N` cap (default 20, max 100).
- Foldable side pane on the left renders the captured rule body
  line-by-line. Statement lines carry an accent `▶` jump-hook;
  the block-mode anchor (`extractor {` opening line) carries a
  red `▶`. Click → matrix scrolls the matching step row into
  view with a 1.5 s flash highlight. Pane folds to a 28 px
  "Captured DSL" stub via a chevron toggle in its header.
- Cell tag groups split into `carried` (status: `original`) and
  `+ added` (`lal-added` + `lal-override`, with the override
  flagged amber). Input cell renders LogData kv + body preview;
  function / output cells render LogBuilder kv + tag chips +
  content preview.
- Click `⤢` on a record header to expand it to a full-width
  single column (sticky block column + DSL pane stay mounted);
  `↩` collapses back.

### OAL
- Per-record card with the same 3-column stage grid as MAL.
- Source / metric payloads render every primitive top-level field
  as `key=value`.
- IDManager `entityId` / `entity_id` decoded inline alongside the
  raw value, e.g.
  `Y2hlY2tvdXQ=.1   (checkout · real)`. Six scopes supported:
  Service / ServiceInstance / Endpoint / ServiceRelation /
  ServiceInstanceRelation / EndpointRelation. Decoder mirrors
  OAP's `IDManager` + `isNormal` boolean (no layer-ordinal
  fabrication).
- Metric `id` (`<timeBucket>_<entityId>`) decoded as
  `2026-05-09 10:36 · checkout · real` with bucket-only
  fallback when the entity portion fails to parse.

## Capture history
- New sidebar entry `Capture history` (`/debug/history`).
- Auto-save to `localStorage` (key `vs:debug-history:v1`) on
  every poll; upsert by `(widget, sessionId)` so polls update
  the same entry in place. Skip-if-unchanged write avoidance.
- Cap **20 entries per widget** (oldest dropped on overflow /
  quota error). Storage is local-only — nothing leaves the
  browser.
- Cross-DSL list with chip-row filter (all / mal / lal / oal),
  newest first.
- Active entries (retention deadline still in the future) carry
  a `live` badge + 1 Hz countdown; **resume →** routes to
  `/debug/{widget}?resumeSessionId=<id>` and reattaches polling
  on OAP without re-allocating a session.
- Completed entries route via `?historyId=<id>` for read-only
  replay with an amber "viewing saved capture" banner.
- Per-row delete + confirm-gated "clear all".

## Cluster status
- `/cluster` page lists every OAP peer the BFF can reach with
  version / uptime / role.
- Per-node DSL-debugging health (probes injected, active
  sessions, cap remaining).

## Dump
- `/dump` page exports the live ruleset across catalogs as a
  `tar.gz` (gated behind `rule:dump`).

## Docker image
- `gcr.io/distroless/nodejs24-debian12:nonroot` runtime base.
- Two-stage build (Node 24 builder → distroless runtime),
  ~150 MB compressed.
- Tags published on every push to main:
  `:sha-<short>`, `:sha-<full>`, `:main`. Release tag
  `:v0.1.0`.
- Cosign keyless signing on every push (`COSIGN_EXPERIMENTAL=1`).
- Configurable via `STUDIO_CONFIG` (path to `studio.yaml`) +
  `STUDIO_UI_DIR` (where the SPA bundle lives) +
  `STUDIO_CONFIG_EXAMPLE` (first-run seed).
- Listens on `:8080` for the SPA + `/api/*`; talks to OAP on
  `:17128` (admin-server) + `:12800` (query-graphql).

## CI
- Lint: ESLint flat config + Vue plugin.
- License headers: `apache/skywalking-eyes` action (replaces
  custom check).
- Tests: 174 across the workspace
  (UI 63 + BFF 82 + api-client 24 + design-tokens 5).
- Image build + push to GHCR + cosign on every push to main.

## Wire types (`@vantage-studio/api-client`)
- New exports: `MAX_RECORD_CAP`, `MAX_RETENTION_MILLIS`
  (mirrors of OAP's `SessionLimits.java`).
- `MalOutputPayload.value`: `number | string | Record<string,
  number>` (per OAP's holder switch — scalar / non-finite-double
  sentinel / `DataTable` for labeled / percentile metrics).
- `SessionRecord.dsl` carries a per-record snapshot of the rule
  body so hot-update edits show up record-by-record without a
  separate fetch.

## Documentation
- `README.md` — overview, quick start, doc index.
- `docs/install.md` — OAP image build + bringing up Studio.
- `docs/configure.md` — `studio.yaml` schema reference.
- `docs/auth.md` — local accounts, argon2id, RBAC verb table,
  deferred LDAP / OIDC design + IAP workaround.
- `docs/docker.md` — image internals, env vars, override
  patterns (compose / k8s with init-container).
- `docs/operator-workflows.md` — five common paths through the
  UI; the live-debugger + capture-history sections rewritten to
  match the SWIP-13 wire shape that ships in 10.5.
- `docs/compatibility.md` — required SkyWalking version + module
  selectors (`SW_ADMIN_SERVER=default`,
  `SW_RECEIVER_RUNTIME_RULE=default`, …).

## Required OAP modules
SWIP-13 selectors all default to disabled upstream; OAP operator
opts in:
- `SW_ADMIN_SERVER=default`
- `SW_RECEIVER_RUNTIME_RULE=default`
- `SW_RECEIVER_DSL_DEBUGGING=default`

## Deferred to a later release
- LDAP / OIDC auth (designed in `docs/auth.md`; IAP-style
  workaround for SSO sites).
- Whole-bundle dump → restore (per-rule restore is wired; bundle
  restore is designed but not in this release).
- Runtime-rule history / diff / rollback (requires OAP-side
  store that doesn't exist yet).
- OAL hot-update (read-only this release; the live debugger
  binds to the recorder, but adding / replacing `.oal` files at
  runtime is not yet supported upstream).

## Acknowledgements
- Built on Apache SkyWalking
  ([SWIP-13 — DSL debugging + admin-server](https://github.com/apache/skywalking/blob/master/docs/en/swip/SWIP-13.md)).
- License headers verified by
  [`apache/skywalking-eyes`](https://github.com/apache/skywalking-eyes).

---

**Full changelog**:
[v0.1.0 commit log](https://github.com/wu-sheng/vantage-studio/commits/v0.1.0)
