<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Compatibility

Studio binds to the **admin-server** module introduced in
[apache/skywalking SWIP-13](https://github.com/apache/skywalking/blob/main/docs/en/swip/SWIP-13.md).
SWIP-13 consolidates the runtime-rule receiver onto a shared HTTP
server and ships a new live-debugger feature alongside it. The SWIP is
fully designed; OAP merge and tagged release will follow.

## OAP version pin

| Studio | OAP commit                                                                  | OAP HTTP surface                                                          |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| v0.1.x | (placeholder — pinned to the SWIP-13 merge commit at integration-test time) | admin-server (`:17128`) + status-query plugin (`:12800`)                  |

The `admin-server` port (`17128`) is the same port the runtime-rule
receiver previously used standalone — URL paths and the port number
are unchanged. What changes is server **ownership**: the embedded
HTTP server in the runtime-rule plugin is removed; runtime-rule's
REST handlers re-register on the shared admin-server.

## Endpoints Studio uses

Port `17128` (admin-server, no auth — gateway-protect):

```
# Runtime-rule (existing URL paths, hosted on admin-server post-SWIP-13)
GET  /runtime/rule/list[?catalog=]
GET  /runtime/rule?catalog=&name=[&source=runtime|bundled]
GET  /runtime/rule/bundled?catalog=[&withContent=]
POST /runtime/rule/addOrUpdate?catalog=&name=
                              [&allowStorageChange=][&force=]
POST /runtime/rule/inactivate?catalog=&name=
POST /runtime/rule/delete?catalog=&name=[&mode=revertToBundled]
GET  /runtime/rule/dump  /  /runtime/rule/dump/{catalog}

# OAL read-only management (NEW — SWIP-13 §4.1)
GET  /runtime/oal/files
GET  /runtime/oal/files/{name}
GET  /runtime/oal/rules
GET  /runtime/oal/rules/{ruleName}

# DSL debugging (NEW — SWIP-13 §4.2)
POST /dsl-debugging/session
GET  /dsl-debugging/session/{id}
POST /dsl-debugging/session/{id}/stop
GET  /dsl-debugging/sessions          # NDJSON
GET  /dsl-debugging/status            # injection / runtime posture
```

Port `12800` (status-query plugin, unchanged):

```
GET  /status/cluster/nodes
```

Studio uses **only** these endpoints. Management catalogs are
`{otel-rules, log-mal-rules, lal}`. Debug-session catalogs are the
same set plus `oal`.

## Operator-facing config break — runtime-rule HTTP keys move to admin-server

SWIP-13 introduces one operator-facing config break, scoped to the
recently-shipped runtime-rule preview:

| Removed                                                                                                                                | New equivalent                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `receiver-runtime-rule.restHost`, `restPort`, `restContextPath`, `restIdleTimeOut`, `restAcceptQueueSize`, `httpMaxRequestHeaderSize`  | `admin-server.host`, `port`, `contextPath`, `idleTimeOut`, `acceptQueueSize`, `httpMaxRequestHeaderSize`    |
| `SW_RECEIVER_RUNTIME_RULE_REST_*` env vars                                                                                             | `SW_ADMIN_SERVER_*` env vars                                                                                |

URL paths and the port (`17128`) are unchanged.

**All three SWIP-13 selectors default to empty (disabled).**
Operators must explicitly opt in to whichever surface they want:

| Env var                           | YAML selector             | Effect                                                  |
| --------------------------------- | ------------------------- | ------------------------------------------------------- |
| `SW_ADMIN_SERVER=default`         | `admin-server.selector`   | Stand up the shared HTTP server on `:17128`.            |
| `SW_RECEIVER_RUNTIME_RULE=default`| `receiver-runtime-rule`   | Register `/runtime/rule/*` + `/runtime/oal/*`.          |
| `SW_DSL_DEBUGGING=default`        | `dsl-debugging`           | Register `/dsl-debugging/*` (live debugger).            |

If a feature is enabled without `admin-server`, OAP fails fast at
boot via the standard `requiredModules()` mechanism with a
`ModuleNotFoundException: admin-server` — operators see the error
and add `SW_ADMIN_SERVER=default`.

## Features Studio ships

- Catalog browse for `otel-rules`, `log-mal-rules`, `lal`.
- YAML editor with Monaco + bundled MAL/LAL DSL grammar autocomplete.
- Push / inactivate / delete / revert-to-bundled.
- Recovery via `force=true`.
- `allowStorageChange` typed-name confirm gate.
- Cluster matrix from BFF fan-out of `/runtime/rule/list`.
- Dump (whole + per-catalog), streaming download.
- **OAL catalog browse** — read-only listing of loaded `.oal` files
  and rules, fed by `/runtime/oal/*`. (OAL hot-update is intentionally
  not in scope; that is a separate, larger feature.)
- **Live debugger** for MAL, LAL, OAL — start/poll/stop sessions,
  per-stage capture rendering, `nodes[]` per-peer coverage,
  `ruleSnapshots` content-hash matching, LAL granularity toggle.
- **DSL-debugging status pane** — surfaces `injectionEnabled`,
  active-session count, and `ruleClassesWithProbes` per cluster node.
- Local auth + optional RBAC + JSONL audit (now including
  `rule:debug` verb).

## Features Studio does NOT ship

- **OAL hot-update** — out of scope upstream; deferred to a future
  SWIP. The path prefix `/runtime/oal/*` is reserved for write
  endpoints when they land.
- **Pre-flight validate** — needs `/runtime/rule/validate`. v1's
  validation loop is push-and-observe.
- **DSL schema autocomplete from server** — needs
  `/runtime/rule/dsl/schema`. Studio ships a static snapshot.
- **History · diff · rollback** — needs `/runtime/rule/revisions[/...]`
  and `/runtime/rule/rollback`. OAP storage is currently
  last-write-wins.
- **Restore** — needs `/runtime/rule/restore`. v1 operators recover
  from a dump by looping `addOrUpdate`.
- **Server-side cluster fan-out + broadcast log** — Studio fan-outs
  from the BFF.
- **OIDC / LDAP** — local-config auth only.
- **Helm chart**, **`vsctl` CLI** — follow-up releases.

The deferred-features list lives in Studio's internal memory under
`feedback_skip_gap_apis.md`; treat this section as the
operator-facing summary.
