# Runtime Rule Hot-Update API

The runtime rule receiver plugin lets operators add, override, inactivate, and delete MAL
rule files (with LAL coming) at runtime without restarting OAP. Changes persist to the
configured storage backend (JDBC, Elasticsearch, or BanyanDB) and propagate across an OAP
cluster via a 30 s reconciler tick.

> For the architectural walkthrough — boot / on-demand / tick workflows, module lifecycle,
> consistency bounds, and cross-cutting invariants — see
> [Runtime Rule Hot-Update — Architecture](../../concepts-and-designs/runtime-rule-hot-update.md).
> This page focuses on the REST API surface and operator CLI.

## ⚠️ Security notice

The admin port has **no authentication** in this release. The module is therefore
**disabled by default**; enabling it opens an HTTP endpoint that can dynamically load
compiled bytecode into the OAP JVM.

Operators enabling the module MUST:

1. Gateway-protect the port with an IP allow-list and separate authentication rules.
2. Never expose port 17128 to the public internet.
3. Bind the HTTP server to `localhost` or a private network interface if remote access is
   not required.

## Enabling the module

Set the selector to `default` in `application.yml` or via env var:

```bash
SW_RECEIVER_RUNTIME_RULE=default
```

Default port is `17128`. All config knobs are in `application.yml` under the
`receiver-runtime-rule` block — host, port, reconciler interval, self-heal threshold.

## HTTP surface

All write endpoints take a raw body (`Content-Type: text/plain`) and catalog + name via
query string. No JSON envelope — makes it trivial to `--data-binary @file.yaml`.

### Canonical routes

| Method | Path | Body | Effect |
|---|---|---|---|
| Method | Path                                                                | Body          | Effect                                                                      |
|--------|---------------------------------------------------------------------|---------------|-----------------------------------------------------------------------------|
| POST   | `/runtime/rule/addOrUpdate?catalog=&name=[&allowStorageChange=true]` | raw rule YAML | compile, classify, apply locally with Suspend + DDL + verify, persist row   |
| POST   | `/runtime/rule/fix?catalog=&name=`                                   | raw rule YAML | recovery — same flow as addOrUpdate with `allowStorageChange=true` forced   |
| POST   | `/runtime/rule/inactivate?catalog=&name=`                            | empty         | flip status to INACTIVE (non-structural)                                    |
| POST   | `/runtime/rule/delete?catalog=&name=`                                | empty         | hard-delete the row (structural)                                            |
| GET    | `/runtime/rule/list`                                                 |               | NDJSON per-row view merged with per-node reconciler state                   |
| GET    | `/runtime/rule/dump[/<catalog>]`                                     |               | tar.gz of all rows + manifest.yaml (source for manual restore)              |

### Catalog shortcut routes

Implicit catalog in the path — useful when scripting against a single catalog:

- `/runtime/mal/otel/{addOrUpdate,fix,inactivate,delete}` → `catalog=otel-rules`
- `/runtime/mal/log/{addOrUpdate,fix,inactivate,delete}` → `catalog=log-mal-rules`
- `/runtime/lal/{addOrUpdate,fix,inactivate,delete}` → `catalog=lal`

### Valid catalogs + names

| Catalog | What it holds |
|---|---|
| `otel-rules` | OTEL MAL rule YAML files |
| `log-mal-rules` | Log-derived MAL rule YAML files |
| `lal` | LAL rule YAML files (LAL apply still log-only in this release) |

Rule `name` mirrors the static filesystem layout — a relative path under the catalog root
without extension. Segments match `[A-Za-z0-9._-]+`, joined by `/`. No leading slash,
no `..`, no empty segments, no backslash. Examples: `nginx`, `aws-gateway/gateway-service`,
`k8s/node`.

### `allowStorageChange` parameter

`/addOrUpdate` (and the three catalog shortcut variants) accept an optional
`allowStorageChange` query parameter. Default is **false** when absent.

The server rejects any update that would move storage identity unless this flag is set:

- **MAL**: scope type change (`service(...)` → `instance(...)`), explicit downsampling
  function change (`.downsampling(SUM)` → `.downsampling(MAX)`), switching between single /
  labeled / histogram variants.
- **LAL**: changing `outputType` on any rule, adding or removing a rule key within a file.

These are the edits that drop an existing BanyanDB measure's data, trigger a re-class under
a different storage function, or orphan rows on JDBC/Elasticsearch. Body/filter/tag tweaks
that preserve the `(functionName, scopeType)` tuple per metric are always accepted — those
route through the reconciler's FILTER_ONLY fast path with no DDL and no alarm window reset.

Accepted truthy forms (case-insensitive): `true`, `1`, `yes`. Anything else is treated as
false.

> **Recommendation — avoid storage-wipe edits in production.** Passing
> `allowStorageChange=true` drops the existing measure's data on BanyanDB and orphans the
> old rows on JDBC / Elasticsearch; any alarm rules, dashboards, and historical queries
> that reference the old shape will miss the pre-change window. Unless the data loss is
> understood and intended — typically only on a staging cluster or during a planned
> schema migration — leave the flag off. Prefer a rename (new metric name, new rule
> name) so the old data keeps accumulating until TTL and the new data starts fresh under
> a clean identity. Treat the flag as an explicit "I accept data loss" affirmation, not a
> convenience toggle.

### Recovery from a failed apply

When an `/addOrUpdate` fails on the receiving node — DSL compile error, shape conflict
with a backend schema that swallowed `ALREADY_EXISTS`, DDL verify mismatch, any throw from
the applier — the node does **not** lose the prior bundle. The restructured apply keeps the
pre-change bundle live for every metric that wasn't explicitly changed in the new content,
and the response is an HTTP 500 with `applyStatus` indicating the failure reason.

**What to expect during a failure:**

- The node keeps serving the prior bundle for **unchanged** metrics. Samples continue
  flowing to the existing measures; dashboards and alarm rules against those metrics keep
  working.
- Metrics that were **newly added** by the failed attempt are rolled back (no orphan
  measures left on BanyanDB).
- Metrics in the **shape-break** set — where the DSL changed a metric's function or scope
  and was allowed through with `allowStorageChange=true` — are lost. The old measure was
  removed before the new one attempted registration; a mid-flight failure leaves neither.
  This is the documented cost of `allowStorageChange`.
- `/runtime/rule/list` reports the bundle's `lastApplyError` so the failure is visible
  without tailing logs.
- The OAP log carries a CRITICAL-level `ERROR` line naming the conflict:
  ```
  runtime-rule reconciler CRITICAL: MAL apply DDL verify FAILED for {catalog}/{name}
    — storage rejected the new shape (schema drift or ALREADY_EXISTS mask). Rolled back
    N newly-registered metric(s); old bundle still serves unchanged metrics.
    Operator action: inspect backend schema + re-push.
  ```
- Peers that were told to Suspend either self-heal back to RUNNING on the old content
  (if the DB row was never committed — REST-handler sync path on failure) or retry the
  same broken content on their next tick and fail the same way (if the DB row advanced
  via the reconciler-tick path). Either way they never serve samples against a moved
  schema while the main node's apply was in-flight.

**Recovery flow:**

1. **Inspect.** `runtime-rule.sh list --catalog=X` or `GET /runtime/rule/list | jq 'select
   (.lastApplyError != null)'`. Confirm which bundle is degraded and read the error message.
2. **Diagnose.** Check the CRITICAL log line. Typical causes:
   - DSL syntax / parse error — fix the YAML and re-push via `/addOrUpdate`.
   - Storage schema moved without the guardrail — push via `/fix` (see below), or rename
     the metric so the old measure keeps accumulating until TTL and new data flows under
     a new identity.
   - Backend unavailable mid-DDL — retry once the backend is healthy; the reconciler will
     also retry on its next tick without any operator action.
3. **Apply the fix.** Two options:

   **Option A: `/runtime/rule/fix` — push a corrected or prior-known-good version with
   storage-change accepted.**

   ```bash
   curl -X POST --data-binary @vm-previous-known-good.yaml \
     "http://OAP:17128/runtime/rule/fix?catalog=otel-rules&name=vm"
   ```

   The `/fix` route is semantically equivalent to `/addOrUpdate?allowStorageChange=true`
   but distinct in access logs so recovery operations are auditable. Use it when the
   operator has explicitly decided the backing measure may be dropped and re-created to
   restore a working state. Same failure modes as `/addOrUpdate` — if the fix content also
   has a bad DSL expression, the node rejects it with 400 `compile_failed` and the prior
   bundle keeps serving.

   **Option B: Manual restore from a prior `/dump` tarball.** If you have a dump taken
   before the broken push, extract the specific file and re-post it through `/fix`:

   ```bash
   # assuming runtime-rule-dump-2026-04-22.tar.gz was taken before the broken push
   tar -xzf runtime-rule-dump-2026-04-22.tar.gz otel-rules/vm.yaml
   curl -X POST --data-binary @otel-rules/vm.yaml \
     "http://OAP:17128/runtime/rule/fix?catalog=otel-rules&name=vm"
   ```

4. **Verify.** Re-run `list` and confirm `lastApplyError` is cleared and `localState` is
   `RUNNING`. Watch the OAP log for the `MAL apply OK for {catalog}/{name}` confirmation.
5. **(Best practice)** Take a fresh `/runtime/rule/dump` immediately after a successful
   recovery so the new baseline is captured for any future incident.

**What `/fix` does NOT do:**

- It does not roll the rule content back to a previous version automatically. Runtime-rule
  storage is last-write-wins; the fix endpoint is a write path, not a rollback path. The
  operator supplies the content to restore.
- It does not bypass DSL compile errors. If the content is syntactically invalid, `/fix`
  returns 400 just like `/addOrUpdate`. The purpose of `/fix` is to accept storage-level
  changes that the guardrail would otherwise block, not to accept broken DSL.

### Response codes

| Status                    | `applyStatus`                                 | Meaning                                                                                                                      |
|---------------------------|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| 200 OK                    | `no_change`                                   | content byte-identical to current row; no-op                                                                                 |
| 200 OK                    | `filter_only_applied`                         | body/filter edits applied via fast path; no DDL, no alarm reset                                                              |
| 200 OK                    | `structural_applied`                          | compile + Suspend + DDL + `isExists` verify + persist all succeeded; bundle is live on the receiving node                    |
| 200 OK                    | (inactivate / delete)                         | row's status flipped to INACTIVE or row hard-deleted                                                                         |
| 202 Accepted              | `persisted_apply_pending`                     | reconciler unavailable at receive time; row is durable, reconciler will apply on its next tick                               |
| 400 Bad Request           | `compile_failed`, `empty_body`, `invalid_*`   | DSL parse failure or request validation failure; row was NOT persisted                                                       |
| 409 Conflict              | `storage_change_requires_explicit_approval`   | update would move storage identity and `allowStorageChange` was not set — no Suspend broadcast, no persist, no side effects  |
| 500 Internal Server Error | `ddl_verify_failed`                           | DDL fired but the post-apply `isExists` check rejected the new shape; new metrics rolled back, old bundle preserved          |
| 500 Internal Server Error | `apply_failed`                                | applier threw mid-register; partial registrations rolled back, old bundle preserved                                          |
| 500 Internal Server Error | `persist_failed`                              | apply succeeded but row write to storage failed; local node serves the new bundle but cluster-wide state is not committed    |

Response body is always JSON: `{applyStatus, catalog, name, message}`.

## Operator CLI

`runtime-rule.sh` wraps the HTTP API. Shipped in the source repo under `scripts/` and
packaged into the distribution under `tools/runtime-rule.sh` (follow-up — pending assembly
wiring).

```bash
# default endpoint: http://localhost:17128
scripts/runtime-rule.sh apply otel-rules/vm.yaml --catalog=otel-rules --name=vm
scripts/runtime-rule.sh list --catalog=otel-rules | jq .
scripts/runtime-rule.sh inactivate --catalog=otel-rules --name=vm
scripts/runtime-rule.sh delete --catalog=otel-rules --name=vm

# DR snapshot + restore
scripts/runtime-rule.sh dump --output=rules.tar.gz
scripts/runtime-rule.sh restore rules.tar.gz

# remote endpoint
scripts/runtime-rule.sh list --endpoint=http://oap-2.internal:17128
```

## Per-node list output

`GET /runtime/rule/list` returns NDJSON (one JSON object per line). Fields:

```json
{
  "catalog": "otel-rules",
  "name": "vm",
  "status": "ACTIVE",
  "localState": "RUNNING",
  "loaderGc": "LIVE",
  "contentHash": "7c3a…",
  "updateTime": 1730000000000,
  "lastApplyError": ""
}
```

- `status` — persisted column: `ACTIVE` | `INACTIVE`.
- `localState` — per-node transient: `RUNNING` | `SUSPENDED` | `NOT_LOADED`. Distinct from
  `status`; a node mid-structural-apply is `ACTIVE` + `SUSPENDED`.
- `loaderGc` — hint at whether the per-file RuleClassLoader is live, retired (pending GC),
  or confirmed collected.
- `contentHash` — SHA-256 of the stored content. The reconciler uses this to detect
  changes; two nodes with the same hash are running the same version.
- `lastApplyError` — most recent local apply error. Empty when the last apply succeeded or
  no attempt has been made.

## Consistency model

- Writes are last-write-wins at the storage layer. Two operators POSTing the same file to
  different OAP nodes race — whichever write hits the DB last wins, and every node
  converges to that content within one reconciler tick (≤ 30 s).
- STRUCTURAL updates (metric set changes, function changes) broadcast a `Suspend` RPC to
  every peer on the OAP cluster bus before applying DDL. Peers that receive the broadcast
  stop serving the old bundle until the main node commits the new version or until the
  60 s self-heal timer reverts them to the old bundle after an aborted apply.
- FILTER_ONLY updates (body-only changes, same metric shape) skip the broadcast — they're
  a local swap on each node.
- Samples for the affected metric are dropped during the structural window. This is by
  design; a structural change means the backend schema is moving and in-flight data has no
  valid landing.

## Known limitations in this release

- LAL hot-update path is log-only — LAL YAML persistence works, but the reconciler
  doesn't swap the LogFilterListener yet.
- STRUCTURAL cluster coordination is defined (Suspend RPC registered on both ends) but the
  reconciler doesn't yet broadcast before apply; single-node apply works, multi-node
  convergence relies on the 30 s tick.
- Per-file `RuleClassLoader` isolation for dynamically generated `Metrics` classes is not
  yet wired — classes land in the default Javassist pool. Shape-breaking re-registration
  works (via CtClass detach in `MeterSystem.removeMetric`) but class instances accumulate
  across churn until JVM restart.
- `AlarmKernelService.reset` hook at the apply tail is not yet wired — alarm windows
  carry stale state across structural metric changes until the next evaluation period
  clears them organically.

See `runtime-rule-hotupdate-design.md` in the project memory for the full design and
remaining work.
