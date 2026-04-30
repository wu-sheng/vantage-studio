<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Compatibility

Studio v1 binds to the **runtime-rule receiver** introduced in
[apache/skywalking#feature/runtime-rule-hot-update](https://github.com/apache/skywalking/tree/feature/runtime-rule-hot-update).
That branch is up for review at the time of v1's release; it isn't
in a tagged OAP release yet.

## OAP version pin

| Studio | OAP commit                                                                   | OAP HTTP surface                                                  |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| v0.1.x | `feature/runtime-rule-hot-update` (squashed; tip `9eeb0a8f66` at v0.1.0 cut) | runtime-rule receiver (`:17128`) + status-query plugin (`:12800`) |

When the upstream feature lands in a tagged release, this matrix
will gain a row pinning Studio v0.1 to that release version.

## Endpoints v1 uses

Port `17128` (runtime-rule admin, no auth):

```
GET  /runtime/rule/list[?catalog=]
GET  /runtime/rule?catalog=&name=[&source=runtime|bundled]
GET  /runtime/rule/bundled?catalog=[&withContent=]
POST /runtime/rule/addOrUpdate?catalog=&name=
                             [&allowStorageChange=][&force=]
POST /runtime/rule/inactivate?catalog=&name=
POST /runtime/rule/delete?catalog=&name=[&mode=revertToBundled]
GET  /runtime/rule/dump  /  /runtime/rule/dump/{catalog}
```

Port `12800` (query / status plugin):

```
GET  /status/cluster/nodes
```

Studio uses **only** these endpoints. Catalogs are limited to
`{otel-rules, log-mal-rules, lal}` — OAL is excluded from
hot-update by upstream design.

## Features Studio v1 ships

- Catalog browse for `otel-rules`, `log-mal-rules`, `lal`.
- YAML editor with Monaco + bundled MAL/LAL DSL grammar autocomplete.
- Push / inactivate / delete / revert-to-bundled.
- Recovery via `force=true`.
- `allowStorageChange` typed-name confirm gate.
- Cluster matrix from BFF fan-out.
- Dump (whole + per-catalog), streaming download.
- Local auth + optional RBAC + JSONL audit.

## Features Studio v1 does NOT ship

These are **deferred** because the backing upstream APIs don't exist
yet (or, in OAL's case, won't):

- **Live debugger** — needs `/runtime/debug/{mal,lal,oal}/sessions/*`.
  The largest single piece of design work; ships when the upstream
  API lands.
- **Pre-flight validate** — needs `/runtime/rule/validate`. v1's
  validation loop is push-and-observe.
- **DSL schema autocomplete from server** — needs
  `/runtime/rule/dsl/schema`. v1 ships a static snapshot.
- **History · diff · rollback** — needs `/runtime/rule/revisions[/...]`
  and `/runtime/rule/rollback`. OAP storage is currently
  last-write-wins.
- **Restore** — needs `/runtime/rule/restore`. v1 operators recover
  from a dump by looping `addOrUpdate`.
- **Server-side cluster fan-out + broadcast log** — Studio fan-outs
  from the BFF in v1.
- **OAL surfaces** — read-only browse + capture. **Permanent
  non-goal** for runtime hot-update; ships in a later release as a
  read-only piece of work.
- **OIDC / LDAP** — v1 is local-config auth only.
- **Helm chart**, **`vsctl` CLI** — follow-up releases.

The deferred-features list lives in Studio's internal memory under
`feedback_skip_gap_apis.md`; treat this section as the
operator-facing summary.
