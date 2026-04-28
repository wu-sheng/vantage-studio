# Required Backend API for Vantage Studio

This document is the **contract** between Vantage Studio (the UI / CLI / BFF)
and the Apache SkyWalking OAP server. It enumerates every endpoint Studio
needs in order to render the designed surfaces, and clearly marks each one as:

- **`[EXISTS]`** — already implemented in the upstream
  `feature/runtime-rule-hot-update` branch (`oap-server/server-receiver-plugin/skywalking-runtime-rule-receiver-plugin`)
  or in the upstream `status-query-plugin`. Studio can call it as-is.
- **`[GAP]`** — does not exist yet and must be added on the OAP side before
  the corresponding Studio surface can ship. A minimum contract is proposed.
- **`[CLIENT]`** — can be computed entirely inside Studio (no OAP change
  needed); listed here so the design intent isn't lost.

All endpoints are spoken over HTTP. Two ports are involved:

| Port | Module | Purpose |
|------|--------|---------|
| `17128` | `receiver-runtime-rule` | Admin port — write & read rule rows. **No auth in OAP.** Studio is the only client; reach it from the BFF over the cluster network. |
| `12800` | `query-graphql` / `status-query` | Read-only status + GraphQL queries. Cluster nodes, alarm rules, TTL config, debugging snapshots. |

> **Auth model.** Studio handles login + RBAC itself. The BFF holds the
> session, enforces role policy, and is the only process allowed to dial
> port `17128`. End users never touch the OAP admin port directly — this is
> the deployment pattern called out in the runtime-rule security notice.

---

## 1. Catalog browsing

### 1.1 List rules across all catalogs `[EXISTS]`

```
GET /runtime/rule/list
Host: oap:17128
Accept: application/x-ndjson
```

NDJSON, one row per rule:

```json
{"catalog":"otel-rules","name":"vm","status":"ACTIVE","localState":"RUNNING","loaderGc":"LIVE","contentHash":"7c3a…","updateTime":1730000000000,"lastApplyError":""}
```

Studio calls this once per catalog page load and uses `contentHash` to detect
drift. Filtering by catalog is client-side; the upstream payload is small
enough.

### 1.2 Fetch a single rule's content `[EXISTS]`

```
GET /runtime/rule?catalog={catalog}&name={name}
Host: oap:17128
Accept: application/x-yaml          ← default; round-trip-safe with /addOrUpdate
       (or application/json)        ← envelope mode
If-None-Match: "{contentHash}"      ← optional; gets 304 Not Modified on hit
```

Default response is raw YAML (`Content-Type: application/x-yaml;
charset=utf-8`). With `Accept: application/json` the response is the
envelope `{catalog, name, status, source, contentHash, updateTime, content}`
where `content` is JSON-escaped UTF-8 (no base64). Either mode emits the
same metadata as response headers — `X-Sw-Content-Hash`, `X-Sw-Status`,
`X-Sw-Source`, `X-Sw-Update-Time`, plus an `ETag` keyed on the content hash
so an editor reload with `If-None-Match` gets a cheap `304`.

Resolution order: DAO row first, then `StaticRuleRegistry` fallback (with
`source=static`, `updateTime=0`). Returns `404 not_found` when neither
exists. No cluster routing — any node can serve.

Catalog allowlist is `{otel-rules, log-mal-rules, lal}` (same as the write
paths). **OAL is not served by this endpoint** — see §1.4.

### 1.3 Bundled / static rules (read-only seed catalog) `[EXISTS, partial]`

```
GET /runtime/rule/bundled?catalog={catalog}[&withContent=true|false]
Host: oap:17128
```

Always JSON. Body is an array of `{name, kind, contentHash, content?,
overridden}`. `content` is included by default; pass `withContent=false`
for a small catalogue browse and lazy-load per-rule via §1.2. The
`overridden` flag is computed by cross-joining with the DAO so the UI
knows which static rules currently have a runtime override in place.

Catalog allowlist is the same `{otel-rules, log-mal-rules, lal}`. The DAO
read is best-effort — if it fails, all entries return with
`overridden=false` and a server log warning. Studio's catalog merges this
with §1.1 to render the grouped-cards view (runtime override row vs. clean
bundled card).

### 1.4 OAL — read-only by design `[SCOPE CORRECTION]`

OAL is **not** in the runtime-rule plugin and is not going to be. This is a
documented exclusion, not a missing feature — see the upstream
[`docs/en/concepts-and-designs/runtime-rule-hot-update.md`](https://github.com/apache/skywalking/blob/feature/runtime-rule-hot-update/docs/en/concepts-and-designs/runtime-rule-hot-update.md)
for the full reasoning. Summary of the three reasons given there:

1. OAL targets SkyWalking-native traffic sources (traces, ALS,
   native-agent telemetry); MAL and LAL target third-party data
   (Prometheus, OTEL, Telegraf, logs). The skip-a-restart value
   concentrates on the third-party-integration side.
2. Operators iterate on MAL and LAL far more often than on OAL. New
   scrape targets, log format changes, filter tightening — vs.
   relatively static OAL definitions.
3. OAL is a deeper integration that lives inside the analytical core;
   MAL and LAL are contained extension points. Extending the feature to
   OAL would mean reshaping platform internals.

This invalidates the parts of the design that imply OAL has a write path:

- **OAL catalog** stays in the UI but every row is read-only — no
  `addOrUpdate / fix / inactivate / delete` affordances. Card states
  collapse to just "bundled". The `allowStorageChange` gate doesn't apply.
- **OAL debugger** (capture sample source rows through one `.oal` line)
  still has standalone value — visualising what a bundled rule actually
  does on real traffic — and stays in scope. Its capture API is §3.3.
- **History · diff · rollback** doesn't apply to OAL (nothing to roll
  back to since nothing was ever pushed).
- **DSL Management — destructive confirm** doesn't apply to OAL.

**Out of scope for v1.** The OAL surface is deferred — both the read-only
catalogue browse and the OAL debugger ship together in a later release,
ideally bundled with the OAL debugging capability so the read API and the
capture API land as one piece of work. Until then, Studio's OAL pages are
hidden behind a feature flag (`STUDIO_FEATURE_OAL=off` by default) and the
top-level menu shows MAL + LAL only.

When the OAL surface lands, the proposed read-only endpoint is:

```
GET /runtime/oal/bundled[?withContent=true|false]
Host: oap:17128
```

A new endpoint parallel to `/runtime/rule/bundled` (§1.3) but specific to
OAL: walks `oap-server/server-starter/src/main/resources/oal/` (and any
plugin-contributed `.oal` overrides), returns a JSON array of
`{file, name, line, expression, contentHash, content?}`. One row per OAL
metric line — the OAL debugger keys on "rule line", so the catalogue's
unit of browsing is a line, not a file.

This is purely a read of files already in the OAP container, exposed so
Studio doesn't have to mount the OAP filesystem. **No write path is ever
added** — the hot-update exclusion in (1)–(3) above is permanent.

---

## 2. Editor — write & validate

### 2.1 Push a rule (create or update) `[EXISTS]`

```
POST /runtime/rule/addOrUpdate?catalog={catalog}&name={name}[&allowStorageChange=true][&force=true]
Host: oap:17128
Content-Type: text/plain
Body: <raw YAML>
```

Two query flags:

- `allowStorageChange=true` — accept storage-identity-changing edits
  (scope flip, downsampling change, single↔labeled↔histogram). Default
  `false`.
- `force=true` — re-run the full apply pipeline even when the content
  hash matches the current row. Used to recover from a broken bundle
  where the row is byte-identical but the in-process state diverged
  (subsumes the role of the prior `/fix` route — see §2.2). Default
  `false`.

Or any of the catalog shortcut routes:

- `POST /runtime/mal/otel/addOrUpdate`
- `POST /runtime/mal/log/addOrUpdate`
- `POST /runtime/lal/addOrUpdate`

Response codes (full table is in the upstream API doc):

- `200 OK` + `applyStatus: no_change | filter_only_applied | structural_applied`
- `202 Accepted` + `persisted_apply_pending` (reconciler will retry)
- `400 Bad Request` + `compile_failed | empty_body | invalid_*`
- `409 Conflict` + `storage_change_requires_explicit_approval`
- `500 Internal Server Error` + `ddl_verify_failed | apply_failed | persist_failed`

Body always JSON: `{applyStatus, catalog, name, message}`.

### 2.2 Recovery push `[FOLDED INTO §2.1]`

The earlier WIP branch carried a separate `POST /runtime/rule/fix` route
for "I'm fixing a broken bundle, accept storage changes". The squashed
final commit removed that route in favour of two flags on `addOrUpdate`:
`force=true` re-runs apply on byte-identical content,
`allowStorageChange=true` accepts shape-breaking edits, and the
combination is the recovery path. The `applyStatus` JSON field plus the
operator's audit trail in Studio's BFF (§8.2) replace the access-log
distinction the dedicated `/fix` route provided.

### 2.3 Inactivate / delete `[EXISTS]`

```
POST /runtime/rule/inactivate?catalog={catalog}&name={name}
POST /runtime/rule/delete?catalog={catalog}&name={name}
```

`/delete` returns `409 requires_inactivate_first` unless the row is already
INACTIVE.

### 2.4 Pre-flight validation (no apply) `[GAP]`

The design's "DSL Management → Validate" surface and the editor's red-squiggle
loop need a parse + classify step that does **not** Suspend peers, does not
hit DDL, and does not persist.

**Proposed:**

```
POST /runtime/rule/validate?catalog={catalog}&name={name}
Host: oap:17128
Content-Type: text/plain
Body: <raw YAML>
```

Response (`200 OK` whether valid or not — failures are encoded in the body):

```json
{
  "ok": true,
  "classifier": "FILTER_ONLY",
  "diff": {
    "metricsAdded": [],
    "metricsRemoved": [],
    "shapeChanges": [
      {"metric":"vm_cpu","change":"scope: service → instance"}
    ]
  },
  "compileErrors": [],
  "lints": [
    {"line":12,"col":4,"severity":"warn","message":"unused tag 'region'"}
  ]
}
```

`classifier` is one of `FILTER_ONLY | STRUCTURAL | NEW`. Studio uses
`shapeChanges[]` to enumerate exactly what `allowStorageChange=true` would
drop, which is the typed-confirm gate's whole reason to exist.

### 2.5 DSL schema for autocomplete `[GAP]`

The form-assisted editor (catalog C in the design) needs a static description
of MAL/LAL/OAL grammar — function names, signatures, scope keywords,
downsampling enums.

**Proposed:**

```
GET /runtime/rule/dsl/schema?lang={mal|lal|oal}
Host: oap:17128
```

Response: JSON schema `{functions: [{name, args, returns, since, doc}],
scopes: [...], downsamplings: [...], outputTypes: [...]}`. Versioned by OAP
release, so the editor's autocomplete and the backend's compiler always
agree on what's legal.

This can be served as a static asset baked into the OAP image — no per-call
work. If the API is too much to ship in v1, Studio will hard-code a snapshot
keyed on OAP version, so this is the lowest-priority gap.

---

## 3. Live debugger — capture, not simulate

The debugger is a **visualizer** of what OAP captured on the real push path.
None of these endpoints exist today. They are the largest single gap.

> Three separate endpoints are intentional: MAL produces `SampleFamily` per
> stage; LAL processes log records one at a time and the natural axis is
> records-as-columns × blocks-as-rows; OAL captures sampled source rows
> rooted on a single `.oal` line. Their shapes are different enough that
> overloading one endpoint hurts more than it helps.

### 3.1 Start a capture session `[GAP]`

```
POST /runtime/debug/{kind}/sessions
Host: oap:17128
Content-Type: application/json
```

`{kind}` ∈ `mal | lal | oal`. Body:

```json
{
  "catalog": "otel-rules",
  "name": "vm",
  "ruleLine": null,                      // OAL only: 1-based line in the .oal file
  "scope": {"type":"instance","entityId":"vm-prod-a7"},
  "blocks": ["text","parser","extractor","sink","output"],   // LAL only
  "maxSamples": 30,
  "windowMs": 60000
}
```

Response:

```json
{"sessionId":"cap_01HXY…","expiresAt":1730000060000,"status":"COLLECTING"}
```

Sampling runs on the receiving OAP node for the requested window. The node
hooks the workflow stages on the real push path, copies a bounded sample of
`SampleFamily` (or log records, or source rows) at each stage, and stores
them under the session id with a short TTL (default 5 min, then GC).

### 3.2 Fetch a capture session `[GAP]`

```
GET /runtime/debug/{kind}/sessions/{sessionId}
```

Response shape — **MAL** (`kind=mal`):

```json
{
  "sessionId":"cap_01HXY…",
  "status":"DONE",
  "rule":{"catalog":"otel-rules","name":"vm"},
  "scope":{"type":"instance","entityId":"vm-prod-a7"},
  "steps":[
    {
      "id":"input","kind":"input","label":"Input SampleFamily (raw OTLP)",
      "inCount":30,"outCount":30,
      "samples":[
        {"labels":{"host":"vm-prod-a7","cpu":"0"},"value":0.42,"ts":1730000000000},
        …
      ]
    },
    {
      "id":"filter#1","kind":"filter","label":".filter(host =~ 'vm-prod-.*')",
      "inCount":30,"outCount":24,
      "samples":[…],
      "dropped":[{"labels":{…},"reason":"filter false"}]
    },
    {"id":"closure#1","kind":"closure","label":".tag('region','us-west')","inCount":24,"outCount":24,"samples":[…]},
    {"id":"scope","kind":"scope","label":"instance(host)","inCount":24,"outCount":24,"samples":[…]},
    {"id":"downsampling","kind":"downsampling","label":".downsampling(AVG)","inCount":24,"outCount":4,"samples":[…]},
    {"id":"store","kind":"store","label":"persist → BanyanDB measure 'vm_cpu'","inCount":4,"outCount":4,
      "samples":[{"entityId":"…","entity":"vm-prod-a7","timestampMinute":1730000040000,"value":0.41,"tags":{…}}]
    }
  ]
}
```

The contract Studio depends on:

- `steps[]` is **ordered** and the names/count vary per rule — Studio
  renders whatever it's handed; it does not know a "filter must come before
  closure" rule.
- Every sample carries `{labels|fields, value, ts}` so the per-stage
  `SampleFamily` table renders the same way at every step.
- The `store` step's sample(s) include `entityId`, `entity` (display name),
  `timestampMinute`, `value`, `tags` — the design's locked-in shape for the
  final-row inspector.

**LAL** (`kind=lal`) — `steps[]` becomes per-block `{id, blockKind:
"text"|"parser"|"extractor"|"sink"|"output.log"|"output.metric"}` and an
extra `records[]` array sits at the top level:

```json
{
  "sessionId":"…","status":"DONE",
  "rule":{"catalog":"lal","name":"envoy-als"},
  "blocks":[
    {"id":"text","blockKind":"text","label":"text — raw log body"},
    {"id":"parser","blockKind":"parser","label":"json { abortOnFailure }"},
    {"id":"extractor","blockKind":"extractor","label":"extractor — service / endpoint / tags"},
    {"id":"sink","blockKind":"sink","label":"sink — enforcer / rateLimit"},
    {"id":"output.log","blockKind":"output.log","label":"output → LogData (Log index)"},
    {"id":"output.metric","blockKind":"output.metric","label":"output → metrics → MAL"}
  ],
  "records":[
    {
      "recordId":"r1","ts":1730000000000,"service":"checkout",
      "perBlock":{
        "text":{"raw":"{\"method\":…}"},
        "parser":{"parsedKeys":["method","status",…]},
        "extractor":{"service":"checkout","endpoint":"/api/items/127","tags":{…}},
        "sink":{"branch":"enforcer","kept":true},
        "output.log":{"persisted":true,"logId":"…"},
        "output.metric":{"metric":"mesh_access_log_count","delta":1}
      }
    },
    …
  ]
}
```

A `perBlock` cell may also carry `{"droppedAt":"sink","reason":"rateLimit"}`
to render the empty-cell placeholder.

**OAL** (`kind=oal`) — picked rule is one line of a `.oal` file (the editor
sends the line number), capture rooted on a single Service:

```json
{
  "sessionId":"…","status":"DONE",
  "rule":{"catalog":"oal","name":"core","line":42,"expression":"endpoint_cpm = from(Endpoint.*).cpm();"},
  "scopeService":{"name":"checkout"},
  "steps":[
    {"id":"source","kind":"source","label":"from(Endpoint.*) — source sample","inCount":20,"outCount":20,"rows":[…]},
    {"id":"filter","kind":"filter","label":".filter(...) — pass-through","inCount":20,"outCount":20,"rows":[…]},
    {"id":"aggregation","kind":"aggregation","label":".cpm()","inCount":20,"outCount":3,"rows":[…]},
    {"id":"store","kind":"store","label":"persist → BanyanDB measure 'endpoint_cpm'","inCount":3,"outCount":3,
      "rows":[{"entityId":"…","entity":"checkout/api/items","timestampMinute":1730000040000,"value":12}]}
  ]
}
```

### 3.3 List recent sessions `[GAP]`

```
GET /runtime/debug/{kind}/sessions?catalog=&name=&limit=20
```

Lets users re-open a recent capture without re-running it.

### 3.4 Cancel / delete a session `[GAP]`

```
DELETE /runtime/debug/{kind}/sessions/{sessionId}
```

---

## 4. Cluster status

### 4.1 Per-rule per-node state matrix `[EXISTS, partial]`

`/runtime/rule/list` already returns `localState | contentHash |
lastApplyError` per rule per node when called against each cluster member.
Studio's BFF fan-outs the call to every member of the cluster (discovered
via §4.3) and pivots the result.

This works but means the BFF needs to know every OAP node's admin port.

**Optional `[GAP]`** for ergonomics:

```
GET /runtime/rule/cluster-state?catalog={catalog}&name={name}
```

Single call, server-side fan-out, returns the matrix:

```json
{
  "catalog":"otel-rules","name":"vm",
  "nodes":[
    {"node":"oap-1","localState":"RUNNING","contentHash":"7c3a…","lastApplyError":"","loaderGc":"LIVE"},
    {"node":"oap-2","localState":"SUSPENDED","contentHash":"5a92…","lastApplyError":"…","loaderGc":"RETIRED"}
  ],
  "convergedHash":"7c3a…",
  "lastBroadcast":{"kind":"Suspend","ts":1730000000000,"acks":["oap-2"],"nacks":[]}
}
```

### 4.2 Suspend/Resume RPC log `[GAP]`

The "broadcast log" side panel needs the recent `Suspend`/`Resume` events
the reconciler fired. The receiver plugin already records these internally;
exposing them is small.

```
GET /runtime/rule/cluster/log?since={ts}&limit=100
```

Response: `[{ts, kind:"Suspend"|"Resume"|"Apply", catalog, name, fromNode,
toNodes, acks, nacks, latencyMs}]`.

### 4.3 OAP cluster nodes `[EXISTS]`

```
GET /status/cluster/nodes
Host: oap:12800
```

Upstream status API. Studio uses this to discover the set of OAP members.

---

## 5. History · diff · rollback

Today, runtime-rule storage is **last-write-wins** with no revision history
on the OAP side — only the current row exists. Studio's history surface
needs the past too.

### 5.1 Revisions `[GAP]`

```
GET /runtime/rule/revisions?catalog={catalog}&name={name}&limit=50
```

Response:

```json
{
  "catalog":"otel-rules","name":"vm",
  "revisions":[
    {"revId":"r_42","contentHash":"7c3a…","appliedBy":"alice","ts":1730000000000,"classifier":"STRUCTURAL","applyStatus":"structural_applied","note":""},
    {"revId":"r_41","contentHash":"5a92…","appliedBy":"bob","ts":1729999000000,"classifier":"FILTER_ONLY","applyStatus":"filter_only_applied","note":""}
  ]
}
```

This implies a new `runtime_rule_revision` storage entity on OAP. Cap
retention by count and/or TTL — Studio doesn't need years of history; weeks
is plenty.

### 5.2 Fetch revision content `[GAP]`

```
GET /runtime/rule/revisions/{revId}
Accept: text/yaml
```

### 5.3 Rollback `[GAP]`

```
POST /runtime/rule/rollback?catalog={catalog}&name={name}&revId={revId}[&allowStorageChange=true]
```

Server-side equivalent of: read revision content → call `addOrUpdate` (or
`fix`) with that body. `allowStorageChange` is required if the rollback
would itself be structural relative to the current shape.

### 5.4 Diff `[CLIENT]`

Pure text diff between any two YAML blobs — done in Studio with `diff` /
`monaco-editor`'s diff viewer. No OAP endpoint needed.

---

## 6. Dump & restore

### 6.1 Dump everything `[EXISTS]`

```
GET /runtime/rule/dump
GET /runtime/rule/dump/{catalog}
```

Returns `application/gzip` — `tar.gz` of all rows + `manifest.yaml`.

### 6.2 Restore `[GAP]`

The CLI doc mentions `runtime-rule.sh restore rules.tar.gz` but there is no
restore HTTP endpoint in the receiver yet (today's restore = `tar -xzf` and
loop `addOrUpdate` for every file).

**Proposed:**

```
POST /runtime/rule/restore[?dryRun=true&allowStorageChange=true]
Host: oap:17128
Content-Type: application/gzip
Body: <tar.gz from /runtime/rule/dump>
```

Response: per-file `{catalog, name, applyStatus, message}` array, and an
overall `{ok, applied, skipped, failed}` summary. `dryRun=true` runs the
validate path only (no Suspend, no DDL, no persist).

---

## 7. DSL Management — destructive confirm

The "type the rule name to confirm" gate is purely a UI affordance; the
server-side enforcement is `allowStorageChange=true` on `addOrUpdate` /
`rollback` / `restore`. No new endpoint needed — Studio just refuses to
flip the flag until the user has typed the rule name **and** the
`/validate` response (§2.4) showed at least one `shapeChanges[]` entry.

---

## 8. Auth / RBAC

### 8.1 OAP-side `[NO CHANGE — by design]`

OAP's runtime-rule receiver explicitly has **no** authentication. Studio
does not try to push auth into OAP — instead, the deployment topology is:

```
[browser] → [Studio UI/BFF (login + RBAC)] → [OAP :17128 admin (no auth, private network)]
                                            └→ [OAP :12800 status (no auth, private network)]
```

OAP's admin port is bound to the cluster's private network and only the BFF
can reach it. This matches the security notice in the upstream API doc.

### 8.2 Studio-side `[STUDIO BFF]`

All endpoints below are served by Studio's own BFF, not OAP:

```
POST /api/auth/login                  { username, password } → { token, user, roles }
POST /api/auth/logout
GET  /api/auth/me                     → { user, roles, permissions }
POST /api/auth/oidc/callback          (when OIDC provider configured)
GET  /api/rbac/policy                 → role → permission matrix (admin only)
PUT  /api/rbac/policy                 → update (admin only)
GET  /api/audit?from=&to=&actor=&action=  → audit trail of every push/inactivate/delete/rollback
```

Authentication backends supported in priority order:

1. **Local users** — bcrypt password file, for trial / single-tenant.
2. **OIDC** — issuer URL + client id/secret in env, group claim → role
   mapping.
3. **LDAP** — bind DN + search filter.

Permission verbs (suggested vocabulary; final list locked when scaffold lands):

| Verb | Routes it gates |
|------|-----------------|
| `rule:read` | catalog browse, list, dump |
| `rule:write` | addOrUpdate, inactivate (FILTER_ONLY only) |
| `rule:write:structural` | addOrUpdate (STRUCTURAL), allowStorageChange, fix |
| `rule:delete` | delete |
| `rule:debug` | start/read capture sessions |
| `rule:rollback` | rollback to a prior revision |
| `cluster:read` | cluster-state, broadcast log |
| `admin` | RBAC editing, audit read, restore |

The BFF translates verbs → OAP HTTP calls; OAP itself never sees Studio's
roles.

---

## 9. Summary — gap matrix

| Surface | Endpoints needed | Status |
|---------|------------------|--------|
| Catalog browse (MAL/LAL) | list, get-rule, bundled | **all exist** |
| Editor — push (MAL/LAL) | addOrUpdate (+ allowStorageChange, force), inactivate, delete | **all exist** |
| Editor — validate / autocomplete | validate, dsl-schema | **both gaps** |
| MAL debugger | sessions × {start, get, list, cancel} | **all gaps** |
| LAL debugger | sessions × {start, get, list, cancel} | **all gaps** |
| Cluster status | list (per-node fan-out), cluster-state, broadcast log, /status/cluster/nodes | 2 of 4 exist |
| History · diff · rollback (MAL/LAL) | revisions list, revision get, rollback (+ client-side diff) | **all gaps** |
| Dump | dump, dump/{catalog} | **both exist** |
| Restore | restore | **gap** |
| DSL Management — destructive (MAL/LAL) | (uses validate + addOrUpdate?allowStorageChange) | depends on §2.4 |
| OAL — read-only browse + debugger | bundled OAL list, OAL capture sessions | **deferred to a later release** (§1.4) |
| Auth / RBAC / audit | Studio BFF only | n/a (Studio scope) |

## 10. v1 scope — what we build now vs. defer

The MAL + LAL hot-update commit `53e180ed0e` on the upstream feature branch
is **finished and end-to-end verified** (three storage backends ×
`runtime-rule-flow.sh`'s 10-phase lifecycle, plus separate LAL and cluster
e2e cases). The Studio v1 binds to **only** the endpoints shipped in that
commit — no upstream ask is on the critical path.

### 10.1 The eight existing endpoints v1 depends on

```
POST   /runtime/rule/addOrUpdate?catalog=&name=[&allowStorageChange=][&force=]
POST   /runtime/rule/inactivate?catalog=&name=
POST   /runtime/rule/delete?catalog=&name=
GET    /runtime/rule?catalog=&name=                    (raw YAML or JSON envelope)
GET    /runtime/rule/list                              (NDJSON, all rows)
GET    /runtime/rule/bundled?catalog=[&withContent=]   (static + overridden flag)
GET    /runtime/rule/dump            /  /runtime/rule/dump/{catalog}     (tar.gz)
GET    /status/cluster/nodes                           (port 12800)
```

(Plus the nine catalog-shortcut variants under `/runtime/mal/otel/*`,
`/runtime/mal/log/*`, `/runtime/lal/*` — Studio uses the canonical routes
and treats the shortcuts as syntactic sugar for the CLI / scripted ops.)

### 10.2 What v1 ships

| Surface | Behaviour |
|---|---|
| **Login + session** | Local users (bcrypt) for trial; OIDC behind a config flag. No LDAP in v1. |
| **RBAC + audit** | Eight verbs (§8.2), audit trail UI for `admin`, every mutating call recorded. |
| **Catalog browse — MAL/LAL** | Grouped cards (design's catalog C) over `/list` ⊕ `/bundled` ⊕ per-rule `/runtime/rule`. |
| **Editor — form-assisted YAML** | Monaco with a **bundled** MAL/LAL DSL snapshot (no `/dsl/schema` endpoint exists). Push via `addOrUpdate` / `inactivate` / `delete`. |
| **Destructive-confirm gate** | Typed-name confirm ⇒ sets `allowStorageChange=true`. The "shape diff" preview from the design is replaced with the upstream warning text quoted verbatim — Studio cannot enumerate `shapeChanges[]` itself without the missing §2.4 validate API. |
| **Recovery flow** | `addOrUpdate?force=true&allowStorageChange=true`, gated to the `rule:write:structural` verb, with an extra audit row tagged `recovery=true`. |
| **Cluster status** | BFF fan-outs `/runtime/rule/list` to every member of `/status/cluster/nodes` and pivots into the per-node × per-rule matrix. **No broadcast log** (no API for it) — surface deferred. |
| **Dump** | Direct passthrough to `/runtime/rule/dump` and `/dump/{catalog}`; the SPA streams the `tar.gz` to the user's download. |
| **Diff** | Client-side only (monaco-diff) — local edited buffer vs. server's current `GET /runtime/rule`. |
| **Docker image + dev compose** | Single image (BFF + SPA), `docker-compose.yml` brings up `studio + oap + banyandb` for local trial. Helm chart in v1.1. |

### 10.3 Deferred to a future Studio release

| Surface | Reason |
|---|---|
| Editor pre-flight validate | §2.4 endpoint not in upstream. Push-and-observe is the v1 validation loop, matching the design's "no dry-run" stance. |
| DSL schema for autocomplete | §2.5 endpoint not in upstream. Studio v1 ships a static snapshot keyed on OAP version. |
| Live debugger (MAL) | §3 capture session API doesn't exist. The largest single chunk of design work — defer until the upstream API lands. |
| Live debugger (LAL) | Same as above. |
| History · diff · rollback | §5 revisions API doesn't exist (storage is last-write-wins, no revision history). Studio's BFF could record its own revision history — **considered**, decided to defer because dump/restore covers the realistic disaster case for v1 and Studio-side revisions would diverge from cluster reality the moment someone pushes via the OAP HTTP API directly. |
| Restore | §6.2 endpoint not in upstream. Operators run a shell loop over `addOrUpdate` for recovery in v1. |
| Server-side cluster-state fan-out + broadcast log | §4.1 / §4.2 not in upstream. BFF-side fan-out covers the matrix; the broadcast log surface is deferred. |
| OAL (read-only browse + debugger) | Intentional non-goal for hot-update per §1.4; ships in a later release together with the OAL capture API as a single read-only piece of work. |
| `vsctl` CLI | Defer until v1 stabilises. Studio v1 is web-only. |

### 10.4 Critical-path for v1

There is no upstream API ask on Studio v1's critical path. Everything in
§10.2 binds to endpoints already merged on the feature branch. Studio's
own work (BFF, SPA, Docker, RBAC) is the only blocker.
