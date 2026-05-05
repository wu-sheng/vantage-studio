<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Install

Vantage Studio ships as a single Docker image. Operators can run it
behind their existing reverse proxy or via the demo `docker compose`
stack that brings up Studio + OAP + BanyanDB together.

## Quick start (demo compose stack)

```bash
git clone https://github.com/wu-sheng/vantage-studio
cd vantage-studio
make compose-up
```

This builds the Studio image locally and runs:

- `studio` on `:8080`
- `oap` (`apache/skywalking-oap-server:runtime-rule`) on the cluster
  network — admin port `17128` and status port `12800` are not
  exposed to the host
- `banyandb` storage on its default port

Visit <http://localhost:8080> and log in:

- **username:** `admin`
- **password:** `vantage-changeme`

> **Replace the default password before exposing this instance.** The
> first-run config seed at `/data/studio.yaml` is hot-reloaded — edit
> it in place and the BFF picks up the change within ~1 s.

`docker compose down --volumes` (or `make compose-down`) wipes the
state.

### Image expectation: `apache/skywalking-oap-server:admin-server`

Studio binds to the **admin-server** module introduced by
[SWIP-13](https://github.com/apache/skywalking/blob/main/docs/en/swip/SWIP-13.md)
— a shared HTTP server (port `17128`) that hosts the runtime-rule
plugin's REST surface alongside OAL listing and the DSL live
debugger. The SWIP isn't in a tagged release yet, so the compose
stack expects an OAP image tagged locally as
`apache/skywalking-oap-server:admin-server` built from the SWIP-13
branch. Build it from a checkout of `apache/skywalking`
(`./mvnw … && docker build …`), or pull from your own CI registry.

### OAP enablement — three opt-in selectors

All three SWIP-13 selectors default to **empty (disabled)**. Set
the following env vars on the OAP container so the surfaces Studio
needs come up:

```env
SW_ADMIN_SERVER=default          # shared HTTP server on :17128
SW_RECEIVER_RUNTIME_RULE=default # /runtime/rule/* + /runtime/oal/*
SW_DSL_DEBUGGING=default         # /dsl-debugging/* live debugger
```

If a feature is enabled without `admin-server`, OAP fails fast at
boot via the standard `requiredModules()` mechanism with a
`ModuleNotFoundException: admin-server`. Set all three together.

> The admin-server has **no authentication** in this release. Reach
> it only over the cluster's private network — never expose port
> `17128` to the public internet.

## Production install

Pull the published image (release artifact, see
[`compatibility.md`](compatibility.md) for version pinning):

```bash
docker pull ghcr.io/wu-sheng/vantage-studio:0.1.0
```

Run with a hand-written config + persistent volume:

```bash
docker run -d \
  --name studio \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /etc/vantage-studio:/data \
  -v /etc/vantage-studio/studio.yaml:/data/studio.yaml:ro \
  ghcr.io/wu-sheng/vantage-studio:0.1.0
```

`/data/` holds the audit log (`audit.jsonl`); mounting `studio.yaml`
read-only is fine because the in-process config watcher is read-only
on its side too — operators edit on the host, the container picks it
up via the bind mount.

See [`configure.md`](configure.md) for every `studio.yaml` knob and
[`auth.md`](auth.md) for the user + RBAC layout.

## Reverse-proxy notes

Studio expects same-origin cookies. If you front it with nginx /
Caddy / a Kubernetes ingress, make sure the proxy preserves
`Set-Cookie` and forwards `Cookie`. Set `session.cookieSecure: true`
in `studio.yaml` once HTTPS is in front. If your proxy adds an
`X-Forwarded-For` header, set `server.trustProxy: true` so audit
entries record the real caller IP.

## Helm chart

Deferred to a follow-up release. Until then, the Docker image works
in a `Deployment` + `Service` + `PersistentVolumeClaim` of your own.
A `NetworkPolicy` denying everything except the Studio pod from
reaching the OAP admin port (`17128`) is recommended — Studio is the
only authenticated client; the OAP admin-server has no auth of its
own. The same NetworkPolicy applies to all admin-server-hosted
surfaces (`/runtime/rule/*`, `/runtime/oal/*`, `/dsl-debugging/*`).
