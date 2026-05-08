<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Docker

How to run the Vantage Studio image and how to override its
configuration. For the YAML schema itself see
[`configure.md`](configure.md); for users / RBAC / audit see
[`auth.md`](auth.md).

## Image

```
ghcr.io/wu-sheng/vantage-studio:<tag>
```

| Tag                          | Source                            | Use                                                            |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `vX.Y.Z` / `latest`          | `release.yml` on `vX.Y.Z` git tag | Production. Cosign-signed, CycloneDX SBOM attestation.         |
| `sha-<short>` / `sha-<full>` | `ci.yml` on every push to `main`  | Tracking head. Cosign-signed; same provenance as the release.  |
| `main`                       | `ci.yml` on every push to `main`  | Floating "latest main commit." Same artifact as `sha-<short>`. |

Verify a pulled image (any tag) before running it in production:

```bash
cosign verify ghcr.io/wu-sheng/vantage-studio:<tag> \
  --certificate-identity-regexp 'https://github.com/wu-sheng/vantage-studio/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## What's inside

Multi-stage build, distroless runtime (`gcr.io/distroless/nodejs24-debian12:nonroot`):

- BFF entry: `/app/server.js` (esbuild bundle of `apps/bff/src/index.ts`)
- SPA bundle: `/app/ui/` (vite `dist`)
- First-run config seed: `/app/studio.yaml.example`
- Production `node_modules` (carries `argon2`'s linux-x64 prebuild + `pino`'s worker tree)

No shell, no package manager, no root user — `nonroot` is uid `65532`.

### Ports + paths the image exposes

| Path / port              | What                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `:8080`                  | Studio HTTP — SPA + `/api/*`. Configurable via `server.listen`.     |
| `/data/`                 | Default mount point for runtime state (config + audit + debug log). |
| `/data/studio.yaml`      | The single config file — `STUDIO_CONFIG` defaults here.             |
| `/data/audit.jsonl`      | Default `audit.file`; one JSON line per actor-initiated event.      |
| `/data/debug-wire.jsonl` | Default `debugLog.file` when enabled.                               |

The container runs as `nonroot` (uid `65532`) so any host directory you bind-mount under `/data/` must be writable by that uid (or be a Docker volume — Docker handles ownership for those).

## Env vars

Three knobs the **container** reads directly. Everything else is in
`studio.yaml`.

| Env var                 | Default                    | Notes                                                                                                                                                                                                                          |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STUDIO_CONFIG`         | `/data/studio.yaml`        | Path the BFF reads + watches. If the file doesn't exist at boot, Studio copies the example seed to this path and continues — useful for first-run with a Docker volume.                                                        |
| `STUDIO_CONFIG_EXAMPLE` | `/app/studio.yaml.example` | Seed copied to `STUDIO_CONFIG` on first run if the target is missing. Set this to your own example to seed a different default. Most operators leave it as-is and mount their own `studio.yaml` over the default path instead. |
| `STUDIO_UI_DIR`         | `/app/ui`                  | Where the BFF serves the SPA bundle from. Don't change unless you've replaced the bundle in a derived image.                                                                                                                   |

**There is no per-field env-var override for `studio.yaml` keys
today.** All configuration goes through the YAML file. To inject
secrets without baking them into the image, mount them as files —
see [Layering secrets on top](#layering-secrets-on-top) below.

## Override paths (in order of common-ness)

### 1. Mount your own `studio.yaml`

The base case. Edit your config on the host, bind-mount it
read-only over the default path:

```bash
docker run -d --name studio --restart unless-stopped \
  -p 8080:8080 \
  -v $PWD/studio.yaml:/data/studio.yaml:ro \
  -v studio-state:/data \
  ghcr.io/wu-sheng/vantage-studio:<tag>
```

The named `studio-state` volume holds `audit.jsonl` (and
`debug-wire.jsonl` when enabled). The `studio.yaml` bind-mount sits
on top of that volume and is read-only — Studio's watcher only ever
reads.

The watcher (`chokidar`) picks up edits, file replacements, and
ConfigMap-style atomic-rename updates. **Hot reloads** — successful
edits take effect within ~1 s, no container restart. Invalid edits
log a warning and the previous valid config keeps serving, so a
typo doesn't take Studio down.

### 2. Point `STUDIO_CONFIG` at a different path

Useful when you have multiple environments' configs in one
directory:

```bash
docker run -d --name studio \
  -p 8080:8080 \
  -e STUDIO_CONFIG=/etc/studio/prod.yaml \
  -v $PWD/configs:/etc/studio:ro \
  -v studio-state:/data \
  ghcr.io/wu-sheng/vantage-studio:<tag>
```

`/data/` still holds `audit.jsonl` (per `audit.file` default) — the
config path doesn't have to live alongside it.

### 3. Layering secrets on top

The image only reads one file, but you can compose it from multiple
sources by writing the merged file in an init step. Two common
patterns:

#### `tmpfs` + `cat` in `command:` (compose / k8s)

Mount the base config + the secret as separate read-only files,
concatenate them into a `tmpfs` at startup. Hot-reload still works
because the merged file lives in the same path the watcher follows.

```yaml
# docker-compose.yml (excerpt)
services:
  studio:
    image: ghcr.io/wu-sheng/vantage-studio:<tag>
    user: 65532:65532
    environment:
      STUDIO_CONFIG: /run/studio/studio.yaml
    volumes:
      - ./base.yaml:/secrets/base.yaml:ro
      - ./secrets.yaml:/secrets/secrets.yaml:ro
      - studio-tmp:/run/studio # tmpfs in k8s
      - studio-state:/data
    entrypoint:
      - /bin/sh
      - -c
      - |
        cat /secrets/base.yaml /secrets/secrets.yaml > /run/studio/studio.yaml
        exec /nodejs/bin/node /app/server.js
volumes:
  studio-tmp:
  studio-state:
```

This entrypoint trick assumes you've baked a small init layer on top
of the distroless runtime — distroless itself has no `/bin/sh`. The
typical fix is a 2-stage image:

```dockerfile
FROM ghcr.io/wu-sheng/vantage-studio:<tag> AS studio
FROM busybox:musl AS init
COPY --from=studio /app /app
COPY --from=studio /nodejs /nodejs
USER 65532
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["cat /secrets/*.yaml > /run/studio/studio.yaml && exec /nodejs/bin/node /app/server.js"]
```

#### Kubernetes: ConfigMap + Secret as separate files

Mount the non-sensitive config from a ConfigMap and the
`auth.local.users[].passwordHash` from a Secret as files in the
same path. The watcher picks up either when its source rotates:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: studio-base
data:
  studio.yaml: |
    server: { listen: 0.0.0.0:8080 }
    oap:
      adminUrls: [http://oap-svc:17128]
      statusUrl: http://oap-svc:12800
    auth:
      backend: local
      local:
        users: []   # filled in by the Secret-mounted overlay below
    rbac:
      enabled: true
      roles:
        admin: { verbs: ['*'] }
---
apiVersion: v1
kind: Secret
metadata:
  name: studio-users
stringData:
  studio.yaml: |
    auth:
      local:
        users:
          - username: alice
            passwordHash: $argon2id$...
            roles: [admin]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: studio }
spec:
  template:
    spec:
      securityContext: { runAsNonRoot: true, runAsUser: 65532 }
      initContainers:
        - name: merge
          image: busybox:musl
          command:
            - sh
            - -c
            - cat /src/base/studio.yaml /src/users/studio.yaml > /run/studio/studio.yaml
          volumeMounts:
            - { name: base, mountPath: /src/base }
            - { name: users, mountPath: /src/users }
            - { name: runtime, mountPath: /run/studio }
      containers:
        - name: studio
          image: ghcr.io/wu-sheng/vantage-studio:<tag>
          env:
            - { name: STUDIO_CONFIG, value: /run/studio/studio.yaml }
          ports: [{ containerPort: 8080 }]
          volumeMounts:
            - { name: runtime, mountPath: /run/studio }
            - { name: state, mountPath: /data }
      volumes:
        - { name: base, configMap: { name: studio-base } }
        - { name: users, secret: { secretName: studio-users } }
        - { name: runtime, emptyDir: { medium: Memory } }
        - { name: state, persistentVolumeClaim: { claimName: studio-state } }
```

The `initContainer` writes the merged `studio.yaml` into a `tmpfs`
emptyDir before the main container starts. ConfigMap and Secret
edits propagate to the running pod via kubelet's atomic-rename;
Studio's watcher sees the change and hot-reloads.

> **Why merge instead of two `STUDIO_CONFIG`s?** The BFF reads one
> file. Adding a second-source overlay is on the roadmap (a
> `STUDIO_CONFIG_OVERLAY` env var that deep-merges) but isn't in
> v0.1; until it lands, an init-container merge is the cleanest
> production pattern.

## docker compose (demo stack)

The repo ships [`deploy/docker/docker-compose.yml`](../deploy/docker/docker-compose.yml)
that brings up Studio + OAP + BanyanDB:

```bash
make compose-up   # docker compose -f deploy/docker/docker-compose.yml up --build
make compose-down # docker compose ... down --volumes
```

Visit <http://localhost:8080> · login `admin` / `vantage-changeme`.
Replace the password by editing `studio.yaml` in the `studio-data`
volume — the watcher hot-reloads.

The compose stack expects an OAP image tagged locally as
`apache/skywalking-oap-server:admin-server` from the SWIP-13 branch.
See [`install.md`](install.md) for the OAP build step.

## Kubernetes notes

- **NetworkPolicy.** Studio is the only authenticated client of the
  OAP admin port (`17128`). Deny everything except the Studio pod
  from reaching it. Same applies to every admin-server-hosted
  surface (`/runtime/rule/*`, `/runtime/oal/*`, `/dsl-debugging/*`).
- **TLS termination.** Set `session.cookieSecure: true` once HTTPS
  is in front. If the proxy adds `X-Forwarded-For`, set
  `server.trustProxy: true` so audit entries log the real caller IP.
- **Persistence.** A small PVC under `/data` is enough — `audit.jsonl`
  is the only thing that grows. Daily rotation is your job
  (`logrotate` sidecar, k8s log shipper that tails the file, or
  fluent-bit).
- **Healthcheck.** None baked into the image yet. A liveness probe on
  `GET /api/auth/me` returning `401` is good enough — the route
  exists and is fast; `401` is the unauth response, which proves the
  server is up and responding.
- **Resource shape.** Single Node.js process, no in-memory rule
  state. ~120 MB RSS at idle, ~250 MB under a busy debug-session
  poll. CPU is bursty per request and otherwise near-zero. One
  replica per cluster is enough — if you want HA, pin to one (active)
  replica + run a second one cold; v1 sessions are in-memory so a
  failover is a re-login.

## Reload + restart semantics

| Event                          | What happens                                                                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit `studio.yaml`             | chokidar fires; new YAML is parsed + zod-validated; on success it replaces the in-memory config. **No restart.** Sessions, vue-query caches in connected SPAs, and audit log handles all carry over. |
| Save invalid YAML              | Parse / schema error logged to stderr. **Previous valid config keeps serving.** No restart, no downtime.                                                                                             |
| Restart the BFF                | All in-memory sessions drop — every operator has to log in again. Audit log keeps appending to the same file.                                                                                        |
| Replace the container          | Same as restart, plus any tmpfs-backed merged config has to be re-merged by the init container.                                                                                                      |
| Image upgrade (rolling deploy) | Plan for a brief 503 between pod terminations. SPA refetches `/api/auth/me`; if the session map is gone, mid-session 401 → SPA hard-redirects to `/login`.                                           |

## See also

- [`configure.md`](configure.md) — every `studio.yaml` knob.
- [`auth.md`](auth.md) — local users, optional RBAC, audit log,
  deferred LDAP / OIDC plan.
- [`compatibility.md`](compatibility.md) — required SkyWalking version
  - OAP module selectors.
- [`install.md`](install.md) — compose quick-start + production
  install hints.
