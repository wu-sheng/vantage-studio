<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Install

Vantage Studio ships as a single Docker image. The fastest way to
see it running is the demo `docker compose` stack that brings up
Studio + OAP + BanyanDB together; for production deployments see
[`docker.md`](docker.md).

## Demo: docker compose stack

```bash
git clone https://github.com/wu-sheng/vantage-studio
cd vantage-studio
make compose-up
```

This builds the Studio image locally and runs:

- `studio` on `:8080`
- `oap` (`apache/skywalking-oap-server:admin-server`) on the cluster
  network — admin port `17128` and status port `12800` are not
  exposed to the host
- `banyandb` storage on its default port

Visit <http://localhost:8080> and log in:

- **username:** `admin`
- **password:** `vantage-changeme`

> **Replace the default password before exposing this instance.** The
> first-run config seed at `/data/studio.yaml` is hot-reloaded — edit
> it in place and the BFF picks up the change within ~1 s. See
> [`auth.md`](auth.md) for the `vsadmin:hash` workflow.

`docker compose down --volumes` (or `make compose-down`) wipes the
state.

## OAP image expectation

Studio binds to the **admin-server** module introduced by
[SWIP-13](https://github.com/apache/skywalking/blob/main/docs/en/swip/SWIP-13.md)
— a shared HTTP server (port `17128`) that hosts the runtime-rule
plugin's REST surface alongside OAL listing and the DSL live
debugger. The compose stack expects an OAP image tagged locally as
`apache/skywalking-oap-server:admin-server` built from the SWIP-13
branch. Build it from a checkout of `apache/skywalking`
(`./mvnw … && docker build …`) or pull from your own CI registry.

The minimum SkyWalking version is **10.5.0** — see
[`compatibility.md`](compatibility.md).

### OAP enablement — three opt-in selectors

All three SWIP-13 selectors default to **empty (disabled)**. Set the
following env vars on the OAP container so the surfaces Studio uses
come up:

```env
SW_ADMIN_SERVER=default          # shared HTTP server on :17128
SW_RECEIVER_RUNTIME_RULE=default # /runtime/rule/* + /runtime/oal/*
SW_DSL_DEBUGGING=default         # /dsl-debugging/* live debugger
```

Without `admin-server`, the runtime-rule and dsl-debugging modules
fail at boot with `ModuleNotFoundException: admin-server`. Enable
all three together.

> The admin-server has **no authentication** in this release. Reach
> it only over the cluster's private network — never expose port
> `17128` to the public internet. Studio is the only authenticated
> client.

## Production

For Docker / Kubernetes deployment patterns, image override knobs,
secret layering, and reverse-proxy notes, see
[`docker.md`](docker.md). For the YAML schema see
[`configure.md`](configure.md). For users + RBAC + audit see
[`auth.md`](auth.md).

## Helm chart

Deferred to a follow-up release. Until then, the Docker image works
in a `Deployment` + `Service` + `PersistentVolumeClaim` of your own —
[`docker.md`](docker.md) has a working manifest.
