<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Configure

Studio reads one file: `studio.yaml`. The path defaults to
`/etc/studio/studio.yaml`, override via the `STUDIO_CONFIG` env var.
The file is **hot-reloaded** — edits take effect without a restart.
An invalid edit is logged and the previous valid config keeps
serving, so a typo doesn't take Studio down.

## Schema

```yaml
server:
  listen: 0.0.0.0:8080 # host:port
  trustProxy: false # honour X-Forwarded-* (set true behind a proxy)

oap:
  adminUrls: # one or more OAP runtime-rule admin URLs
    - http://oap-1:17128 # writes go to the first; reads fan out to all
    - http://oap-2:17128
  statusUrl: http://oap:12800 # OAP query/status plugin (cluster discovery)

auth:
  backend: local # only "local" in v1; OIDC + LDAP later
  local:
    users:
      - username: admin
        passwordHash: $argon2id$... # generate with `vsadmin hash`
        roles: [admin] # consulted only when rbac.enabled

rbac: # OPTIONAL — absent means everyone has full access
  enabled: true
  roles:
    admin: { verbs: ['*'] }
    operator: { verbs: [rule:read, rule:write, rule:write:structural, rule:delete, rule:debug, cluster:read] }
    viewer: { verbs: [rule:read, cluster:read] }

session:
  ttlMinutes: 60
  cookieName: sid
  cookieSecure: true # MUST be true behind HTTPS

audit:
  file: /data/audit.jsonl # absolute path; daily rotation is your job

debugLog: # OPTIONAL — wire-level capture for integration testing
  enabled: false
  file: /data/debug-wire.jsonl
  maxBodyChars: 8192
  redactAuthHeaders: true
```

## Field reference

### `server`

| Field        | Default        | Notes                                                                                      |
| ------------ | -------------- | ------------------------------------------------------------------------------------------ |
| `listen`     | `0.0.0.0:8080` | `host:port`. Use `127.0.0.1:8080` if a sidecar reverse proxy handles ingress.              |
| `trustProxy` | `false`        | When `true`, Fastify reads `X-Forwarded-For` etc. so audit entries log the real caller IP. |

### `oap`

| Field       | Required | Notes                                                                                                                                                                                                                                                                                    |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adminUrls` | yes      | Array of base URLs to OAP's `admin-server` (default port `17128` — same port runtime-rule used standalone before SWIP-13). The BFF fans `/runtime/rule/list` out across every URL for the cluster matrix and fans `/dsl-debugging/status` for the debugger health pane. **Writes** (`addOrUpdate`, `inactivate`, `delete`) hit only the first URL — OAP's forward-RPC handles peer convergence. **Live debugger** session installs hit the first URL too; OAP itself broadcasts `InstallDebugSession` cluster-wide. |
| `statusUrl` | yes      | OAP query/status plugin URL (default `12800`). Used for `/status/cluster/nodes` lookups.                                                                                                                                                                                                 |
| `timeoutMs` | no       | Per-call timeout (ms) for every BFF→OAP request. Default `10000`. Set to `0` to disable. The cluster fan-out shares this timeout per node — a slow node times out individually without stalling the whole call.                                                                          |

> **OAP-side opt-in.** The admin-server, runtime-rule, and dsl-debugging
> selectors all default to empty on OAP. Set
> `SW_ADMIN_SERVER=default`, `SW_RECEIVER_RUNTIME_RULE=default`, and
> `SW_DSL_DEBUGGING=default` on the OAP container so the URLs Studio
> calls actually exist. See [`install.md`](install.md) for details.

### `auth`

`backend: local` is the only v1 option. OIDC + LDAP are deferred.

`auth.local.users[]` entries:

| Field          | Required | Notes                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------- |
| `username`     | yes      | Pattern `[A-Za-z0-9._-]+`, max 64 chars.                                      |
| `passwordHash` | yes      | argon2id hash. Generate with `pnpm -F @vantage-studio/bff vsadmin:hash <pw>`. |
| `roles`        | no       | Defaults to `[]`. Only consulted when `rbac.enabled`.                         |

### `rbac` (optional)

When **absent** (or `enabled: false`), every authenticated user has
the wildcard `*` verb — full access. This is the default for trial /
single-tenant deployments.

When **enabled**:

- `rbac.roles` is a map of role-name → `{verbs: [...]}`. Verbs match
  the table below.
- A user's effective verbs are the union of their roles' verbs.
- `*` is the wildcard; granting it is equivalent to "no RBAC for this
  user."

Verb table:

| Verb                    | Routes it gates                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `rule:read`             | catalog browse, single-rule fetch, dump, OAL catalog browse                            |
| `rule:write`            | `addOrUpdate` (filter-only), `inactivate`                                              |
| `rule:write:structural` | `addOrUpdate` with `allowStorageChange=true` or `force=true`; `revertToBundled` delete |
| `rule:delete`           | `delete` (default mode)                                                                |
| `rule:debug`            | live debugger — start / poll / stop debug sessions across MAL / LAL / OAL              |
| `cluster:read`          | cluster matrix, dsl-debugging status pane                                              |
| `admin`                 | (reserved — audit-read in a later release)                                             |
| `*`                     | all of the above                                                                       |

One more verb (`rule:rollback`) is reserved for the deferred history
surface; it has no current effect.

### `session`

| Field          | Default | Notes                                                                            |
| -------------- | ------- | -------------------------------------------------------------------------------- |
| `ttlMinutes`   | `60`    | Absolute lifetime per login. No sliding window in v1 — re-login when it expires. |
| `cookieName`   | `sid`   | If you change it, every browser session ends.                                    |
| `cookieSecure` | `true`  | **Set to `true` behind HTTPS.** Set `false` only for local-HTTP demo.            |

### `audit`

| Field  | Default                               | Notes                                                                                             |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `file` | `/var/lib/vantage-studio/audit.jsonl` | One JSON line per actor-initiated event. Daily rotation is external (logrotate, k8s log shipper). |

### `debugLog` (optional)

Wire-level capture of every `/api/*` request and every BFF→OAP
outbound call into a single JSONL file. **Off by default.** Useful
when integration-testing Studio against a real OAP build to spot
field-level deviations from the SWIP-13 payload contract.

| Field               | Default                                    | Notes                                                                                                           |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `enabled`           | `false`                                    | Hot-reloadable — flip to `true` for a scenario, flip back to `false` afterwards.                                |
| `file`              | `/var/lib/vantage-studio/debug-wire.jsonl` | Daily rotation is external (same contract as `audit.file`).                                                     |
| `maxBodyChars`      | `8192`                                     | Per-leaf char cap; longer bodies get a `… +N chars truncated` marker (mirrors SWIP-13 §5's truncation).         |
| `redactAuthHeaders` | `true`                                     | Strips `Cookie` / `Authorization` / `Set-Cookie` / `X-Forwarded-For`. `/api/auth/login` request body is always redacted regardless. |

Each event has a `traceId` shared between the inbound `/api/*`
request and every downstream OAP outbound it triggered, so a
single browser action can be reconstructed from the JSONL with one
`grep` on the traceId.

## Reload behaviour

The watcher is `chokidar`; it picks up file replacements, edits in
place, and `kubectl rollout restart`-style ConfigMap updates. The
loader logs:

```
[vantage-studio] studio.yaml reloaded
```

on success and

```
[vantage-studio] config reload failed; keeping previous config <error>
```

on parse / schema failure. Runtime state (sessions, in-flight
requests) is preserved across a successful reload.
