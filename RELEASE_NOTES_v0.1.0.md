# Vantage Studio v0.1.0

First public release. Vantage Studio is a web admin for Apache
SkyWalking's runtime-rule hot-update system — it adds login, RBAC,
catalog management, and a per-DSL live debugger on top of OAP's
`admin-server` (port `17128`) + query (`12800`) HTTP surfaces. Runs
as a single distroless container, talks to a stock SkyWalking 10.5+
cluster.

## Highlights

### Catalog & editor

- **Rule browser** for the three SkyWalking DSL catalogs that the
  runtime-rule receiver exposes — `otel-rules`, `log-mal-rules`,
  `lal` — plus a dedicated `oal` page (read-only catalogue of
  bundled `.oal` source files; OAL is operator-managed at install
  time, not hot-updatable yet).
- **YAML editor** built on Monaco with bundled MAL / LAL DSL
  grammars, content hashing, and a "filter-only edit" path that
  pushes a body change without bumping the alarm window or
  triggering DDL.
- **Hot-update** through OAP's `runtime/rule/{addOrUpdate,
  inactivate, delete}` endpoints — every action is audited
  (`actor` / `verb` / `outcome` / `clientIp` / JSONL log per
  `auth.md`) and gated behind RBAC verbs.
- **Bundled-vs-runtime view** shows when a runtime override exists
  alongside the in-image static rule, with side-by-side diff.

### Live debugger (MAL · LAL · OAL)

A first-class operator surface for the SWIP-13 `/dsl-debugging/*`
flow. Pick a rule, hit **start sampling**, and watch records arrive
in real time as polls land. Each DSL gets a tailored layout:

- **MAL** — per-record card with a rule-meta strip
  (`metric / filter / exp / suffix`) and a 3-column stage grid
  (`label · rail · rows-table`). Click a step to highlight the
  matching `sourceText` `<mark>`'d in the rule strip. The output
  meter renders only what the wire serialises (`metric`,
  `function`, `value` when present — scalar `number`, `string` for
  non-finite, or `Record<string, number>` for histogram-percentile
  / `*Labeled`, `timeBucket`); the entity card collapses null
  fields with a `show all` toggle.
- **LAL** — per-record × per-block matrix with a sticky leftmost
  block-label column, a search field that filters by log
  body/content/tag, and a `show first N` cap (default 20, max 100)
  for big captures. Function rows in statement-mode carry the
  verbatim DSL slice as their name (`tag stage: 'extractor'` …);
  block-mode collapses to one row labelled `extractor`. A foldable
  side pane renders the captured rule body with line-by-line `▶`
  hooks that scroll the matrix to the matching step row (red `▶`
  for the block-mode anchor). Click a record's `⤢` to expand it
  to a single-column full-width view (sticky column + DSL pane
  stay mounted); `↩` collapses back.
- **OAL** — per-record card with the same 3-column stage grid as
  MAL. Source / metric payloads render every primitive field as
  `key=value`. The IDManager `entityId` / `entity_id` (and metric
  `id` = `<timeBucket>_<entityId>`) get a decoded annotation next
  to the raw value:
  ```
  entityId  Y2hlY2tvdXQ=.1                  (checkout · real)
  id        202605091036_Y2hlY2tvdXQ=.1     (2026-05-09 10:36 · checkout · real)
  ```
  The decoder mirrors OAP's `IDManager` + `isNormal` flag for all
  six scopes (Service / ServiceInstance / Endpoint /
  ServiceRelation / ServiceInstanceRelation / EndpointRelation).

Common to all three views:

- **Per-cluster install ack strip** above the capture
  (`installed` / `already_installed` / `failed` / `timeout` per
  peer).
- **Defaults match OAP's `SessionLimits.MAX_RECORD_CAP = 100`**
  for both record cap (default + hard ceiling) and a 5-min
  retention window (1 h hard cap). `recordCap > 100` is rejected
  client-side with `400 invalid_recordCap` before the OAP
  round-trip.

### Capture history (browser-local)

Every session is mirrored to `localStorage` (key
`vs:debug-history:v1`) on each poll, so closing the tab or losing
the connection doesn't lose the capture. New sidebar entry
**Capture history** (`/debug/history`) lists every entry across all
three DSLs with a per-widget filter:

- **Active** entries (retention deadline still in the future) carry
  a `live` badge + 1 Hz countdown; **resume →** routes to
  `/debug/{widget}?resumeSessionId=<id>` which reattaches polling
  without re-allocating a session on OAP.
- **Completed** entries route via `?historyId=<id>` for read-only
  replay with an amber "viewing saved capture" banner and a
  back-to-live control.

Capped at 20 entries per widget (oldest dropped on overflow / quota
error). Storage is local-only — nothing leaves the browser.

### Auth & RBAC

- Local accounts in `studio.yaml` (argon2id-hashed; bring your own
  password via the `vsadmin:hash` CLI tool — see
  [`docs/auth.md`](docs/auth.md)). Default admin/admin on
  first-run, with a forced-rotation banner.
- In-memory session store (cookie-based, `Secure` + `HttpOnly` +
  `SameSite=Strict`); LDAP / OIDC are designed but not in v0.1
  (see auth.md for the IAP workaround pattern).
- RBAC verbs gate every BFF route (`rule:read`, `rule:write`,
  `rule:debug`, `rule:dump`, `rule:storage_change`,
  `rule:revert_bundled`). Read-only by default; the admin role
  carries every verb.

### Cluster status

- **Cluster** page at `/cluster` lists every OAP peer the BFF can
  reach, with version, uptime, role, and a per-node DSL-debugging
  health snapshot (probes injected? active sessions? cap
  remaining?).
- **Dump & restore** at `/dump` produces a `tar.gz` of the live
  ruleset across catalogs (gated behind `rule:dump`); restore is
  designed but deferred — see Known limitations.

## Supported targets

- **Apache SkyWalking 10.5.0+** (the first OAP release that ships
  `admin-server`, the runtime-rule receiver, `/runtime/oal/*`, and
  `/dsl-debugging/*`). Earlier versions are not supported.
- **Node.js 24 LTS** — runtime base for the BFF.
- **Browsers**: latest Chrome / Firefox / Safari / Edge. Monaco +
  Vue 3 SPA, no IE / legacy-Edge polyfills.
- **Storage**: none. The BFF is stateless — auth uses an in-memory
  session store; capture history is browser-local only.

See [`docs/compatibility.md`](docs/compatibility.md) for the full
required-OAP-modules matrix (`SW_ADMIN_SERVER`,
`SW_RECEIVER_RUNTIME_RULE`, etc. — all three SWIP-13 selectors
default to disabled upstream and the OAP operator must opt in).

## Docker image

```
ghcr.io/wu-sheng/vantage-studio:v0.1.0
ghcr.io/wu-sheng/vantage-studio:main          (rolling tip-of-main)
ghcr.io/wu-sheng/vantage-studio:sha-<short>   (every push to main)
```

- Base: `gcr.io/distroless/nodejs24-debian12:nonroot`
- Two-stage build (Node 24 builder → distroless runtime); ~150 MB
  compressed.
- Cosign-signed (keyless OIDC) on every push.
- Configurable via `STUDIO_CONFIG` (path to `studio.yaml`) +
  `STUDIO_UI_DIR` (where the SPA bundle lives) — see
  [`docs/docker.md`](docs/docker.md) for compose / k8s / overlay
  patterns.

## Known limitations (deferred to a later release)

- **LDAP / OIDC** — auth.md documents the deferred design and an
  IAP-style workaround for sites that need SSO today.
- **Dump-side restore** — dump produces a `tar.gz`, restore from
  one is wired only for individual rules; whole-bundle restore is
  designed but not in this release.
- **Runtime-rule history / diff / rollback** — Studio shows the
  current state only; rule-edit history requires an OAP-side
  store that doesn't exist yet (see SWIP-13 deferred section).
- **OAL hot-update** — OAL is read-only in this release; the OAL
  page is a discovery surface (catalogue of bundled scripts) and
  the live debugger binds to the recorder, but adding / replacing
  `.oal` files at runtime is not yet supported by upstream.

## Breaking change policy

v0.1.x is an early release; the wire types in
`@vantage-studio/api-client` track SWIP-13's evolving shape. Any
shape change documented in the per-version CHANGELOG before tagging.

## Acknowledgements

- Built on [Apache SkyWalking](https://skywalking.apache.org/)'s
  runtime-rule hot-update + `dsl-debugging` work
  ([SWIP-13](https://github.com/apache/skywalking/blob/master/docs/en/swip/SWIP-13.md)).
- License headers verified by
  [`apache/skywalking-eyes`](https://github.com/apache/skywalking-eyes)
  in CI.

---

**Full changelog**:
[v0.1.0 commit log](https://github.com/wu-sheng/vantage-studio/commits/v0.1.0)
