<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Auth

Studio in v1 supports **local authentication only** — usernames +
argon2id-hashed passwords listed in `studio.yaml`. RBAC is optional;
absent it everyone has full access. The audit log captures every
mutating call.

## What's supported

| Backend         | Status               | Notes                                                                                                       |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Local**       | ✓ shipped            | `auth.backend: local` (the only valid value today). Users + argon2id hashes in `studio.yaml`. Hot-reloaded. |
| **LDAP / AD**   | deferred (see below) | Not implemented in v1. The `auth.backend` enum only accepts `local` — even with the field present.          |
| **OIDC / SAML** | deferred (see below) | Same as LDAP.                                                                                               |

> The `studio.yaml` schema enforces `auth.backend = "local"`; setting
> anything else trips a zod validation error at config-load time and
> the previous valid config keeps serving. We'd rather fail loudly
> than silently treat an unknown backend as a no-op.

### Why local-only first

Studio's surface is small — one operator console for one cluster.
The point of v1 is the rule-management UX itself, not an enterprise
identity matrix. Local auth covers:

- Internal-network deploys behind a corporate SSO at the network edge
  (an Identity-Aware Proxy / oauth2-proxy / Pomerium in front handles
  the actual SSO; Studio is one local user behind that).
- Air-gapped / on-prem evaluations.
- Per-team operator groups where a 2-line YAML edit beats a directory
  integration.

### The deferred path

LDAP and OIDC will land as alternative `auth.backend` values:

- `auth.backend: ldap` — `auth.ldap.{url, bindDN, bindPassword,
userSearchBase, groupSearchBase}`. RBAC roles map from LDAP groups
  (configurable). No password hashes in `studio.yaml`.
- `auth.backend: oidc` — `auth.oidc.{issuer, clientId, clientSecret,
redirectUri, scopes}` via `openid-client`. Roles map from a chosen
  claim (`groups` / `roles` / custom).

Both are pure-additive — the `local` backend keeps working unchanged.
**Until they ship**: front Studio with an Identity-Aware Proxy that
terminates SSO and forwards a single shared local credential. That's
the documented production pattern in [`docker.md`](docker.md).

## Adding a user

1. Generate an argon2id hash:

   ```bash
   pnpm -F @vantage-studio/bff vsadmin:hash 'my-new-password'
   # or, in the running container:
   #   docker exec -it studio /nodejs/bin/node /app/server.js --hash 'my-new-password'
   #   (the --hash entrypoint is wired in v0.2)
   ```

   `stdin` works too:

   ```bash
   echo -n 'my-new-password' | pnpm -F @vantage-studio/bff vsadmin:hash
   ```

2. Add the entry to `studio.yaml`:

   ```yaml
   auth:
     local:
       users:
         - username: alice
           passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$...'
           roles: [operator]
   ```

3. Save. Studio's config watcher picks up the change within ~1 s; no
   restart needed.

## Removing a user

Delete the entry. Any active session for that user keeps working
until it expires (`session.ttlMinutes`). If you need to revoke
immediately, restart the BFF — sessions are in-memory, so a restart
clears every active session.

## RBAC

RBAC is **opt-in**. Without an `rbac:` block in `studio.yaml`, every
authenticated user has the wildcard `*` verb — full access. That's
the right default for trial deployments and single-team operator
groups.

Turn it on by adding the block:

```yaml
rbac:
  enabled: true
  roles:
    admin:
      verbs: ['*']
    operator:
      verbs:
        - rule:read
        - rule:write
        - rule:write:structural
        - rule:delete
        - rule:debug
        - cluster:read
        - inspect:read
    viewer:
      verbs:
        - rule:read
        - cluster:read
        - inspect:read
```

A user's effective verbs are the union of their assigned roles'
verbs. Roles are assigned in the user list:

```yaml
auth:
  local:
    users:
      - username: alice
        passwordHash: $argon2id$...
        roles: [operator]
      - username: bob
        passwordHash: $argon2id$...
        roles: [viewer]
```

The current user's effective verbs are visible in the **Permissions**
page (left nav, bottom).

### Verb table

| Verb                    | Routes it gates                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `rule:read`             | catalog browse, single-rule fetch, dump, OAL catalog browse                            |
| `rule:write`            | `addOrUpdate` (filter-only), `inactivate`                                              |
| `rule:write:structural` | `addOrUpdate` with `allowStorageChange=true` or `force=true`; `revertToBundled` delete |
| `rule:delete`           | `delete` (default mode)                                                                |
| `rule:debug`            | live debugger — start / poll / stop debug sessions across MAL / LAL / OAL              |
| `cluster:read`          | cluster matrix, dsl-debugging status pane                                              |
| `inspect:read`          | Inspect (SWIP-14) — `/api/inspect/{catalog,metrics,entities,mqe-target,exec}`          |
| `admin`                 | (reserved — audit-read in a later release)                                             |
| `*`                     | all of the above (wildcard)                                                            |

Highlights:

- `rule:write:structural` is the gate on every schema-change action —
  `addOrUpdate` with `allowStorageChange=true`, `force=true` recovery,
  and `revertToBundled` delete. Operators who only need
  filter-of-existing-metric edits can hold `rule:write` alone.
- Default `delete` is **not** schema-changing in v1 — the row is
  removed and any backend resource is left as an inert artefact.
  `rule:delete` covers it. The destructive path is
  `revertToBundled`, which needs both `rule:delete` and
  `rule:write:structural`.

## Audit

Every mutating call lands in the JSONL file at `audit.file` (default
`/data/audit.jsonl` in the Docker image). One line per event:

```json
{
  "level": "info",
  "ts": 1730000000000,
  "action": "addOrUpdate",
  "verb": "rule:write",
  "actor": "alice",
  "outcome": "filter_only_applied",
  "details": { "catalog": "otel-rules", "name": "vm", "allowStorageChange": false, "force": false },
  "fromIp": "10.0.0.42",
  "sessionId": "xy…"
}
```

Failed attempts are recorded too:

```json
{"level":"info","ts":...,"action":"addOrUpdate","verb":"rule:write","actor":"alice","outcome":"storage_change_requires_explicit_approval",...}
{"level":"info","ts":...,"action":"login","actor":null,"outcome":"bad_password","details":{"username":"alice"},...}
```

Daily rotation is your job — point a `logrotate` config or a
sidecar log shipper at the file. Studio doesn't rotate; the line
volume is low (one event per operator action) so files stay small.

## Session model

- Opaque 32-byte session id in a `HttpOnly` + `SameSite=Strict` +
  `Secure` cookie.
- Server-side state is an in-memory `Map` per BFF process. Logout
  deletes the entry.
- TTL is absolute (`session.ttlMinutes`); there's no sliding window.
- Sessions are lost on BFF restart — operators re-log in. For an
  internal tool that's the right trade-off; the alternative
  (server-side persistent sessions or signed JWTs with denylists)
  adds complexity that doesn't pay back.
- v1 is single-replica. Multi-replica HA needs a shared session
  store; revisit when there's a request.
