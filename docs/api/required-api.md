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

### 1.2 Fetch a single rule's content `[GAP]`

The current `/runtime/rule/list` does not include the YAML body. Studio's
catalog → row click and the editor both need the source.

**Proposed:**

```
GET /runtime/rule?catalog={catalog}&name={name}
Host: oap:17128
Accept: text/yaml
```

Response: raw YAML (or `application/json` envelope `{catalog, name, status,
contentHash, content}` — pick one and document; Studio prefers raw + headers
`X-Sw-Content-Hash`, `X-Sw-Status`).

Returns `404` when the rule has no DB row and no static-on-disk bundle.

### 1.3 Bundled / static rules (read-only seed catalog) `[GAP]`

The catalog needs to show the rules that ship with OAP (e.g. the bundled
`.oal` files in `oap-server/server-starter/src/main/resources/oal/`,
`/lal/`, `/otel-rules/`) so users can browse them and decide whether to
override at runtime. Today there is no API for this — they're filesystem
artefacts inside the OAP container.

**Proposed:**

```
GET /runtime/rule/bundled?catalog={catalog}
Host: oap:17128
```

Response: JSON array `[{name, contentHash, content, kind: "bundled"}]`. The
existing list view already represents runtime overrides; this is the static
side. Studio merges the two for the grouped-cards view.

---

## 2. Editor — write & validate

### 2.1 Push a rule (create or update) `[EXISTS]`

```
POST /runtime/rule/addOrUpdate?catalog={catalog}&name={name}[&allowStorageChange=true]
Host: oap:17128
Content-Type: text/plain
Body: <raw YAML>
```

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

### 2.2 Recovery push `[EXISTS]`

```
POST /runtime/rule/fix?catalog={catalog}&name={name}
```

Equivalent to `addOrUpdate?allowStorageChange=true` but logged distinctly
for audit.

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
| Catalog browse | list, get-rule, bundled | 1 of 3 exists |
| Editor — push | addOrUpdate, fix, inactivate, delete | **all exist** |
| Editor — validate / autocomplete | validate, dsl-schema | **both gaps** |
| MAL debugger | sessions × {start, get, list, cancel} | **all gaps** |
| LAL debugger | sessions × {start, get, list, cancel} | **all gaps** |
| OAL debugger | sessions × {start, get, list, cancel} | **all gaps** |
| Cluster status | list (per-node fan-out), cluster-state, broadcast log, /status/cluster/nodes | 2 of 4 exist |
| History · diff · rollback | revisions list, revision get, rollback (+ client-side diff) | **all gaps** |
| Dump | dump, dump/{catalog} | **both exist** |
| Restore | restore | **gap** |
| DSL Management — destructive | (uses validate + addOrUpdate?allowStorageChange) | depends on §2.4 |
| Auth / RBAC / audit | Studio BFF only | n/a (Studio scope) |

**Critical path for v1:** the seven gaps in **§2.4 validate**, **§3 debugger
sessions** (all three kinds), and **§5 revisions/rollback** are the largest
upstream asks. Without §2.4 the destructive-confirm gate is empty; without
§3 the live debugger doesn't exist; without §5 there is no history surface.
Everything else can ship as a thin wrapper over what's already there.
