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

### OAP enablement — four required selectors

Studio's BFF only talks to admin-server-bound OAP modules. All four
selectors default to **empty (disabled)** in stock OAP; Studio
**requires all four**. Set them on the OAP container:

```env
SW_ADMIN_SERVER=default          # shared HTTP server on :17128 (host module for the others)
SW_RECEIVER_RUNTIME_RULE=default # /runtime/rule/* + /runtime/oal/*
SW_DSL_DEBUGGING=default         # /dsl-debugging/* live debugger
SW_INSPECT=default               # /inspect/* — catalog + entity browser (SWIP-14)
```

What breaks if you omit each one:

| Selector                   | What stops working in Studio                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SW_ADMIN_SERVER`          | Everything. Without the host module, the other three fail at boot with `ModuleNotFoundException: admin-server`.                                                                                                                                             |
| `SW_RECEIVER_RUNTIME_RULE` | DSL Management pages (Catalog, OAL catalog), the Editor's rule fetch/save path, the Cluster status rule-convergence matrix, the Live debugger's rule picker, and the Inspect drawer's source attribution (every metric falls back to the `unknown` bucket). |
| `SW_DSL_DEBUGGING`         | The Live debugger across all three DSLs (start / poll / stop), and the DSL-debugging health pane in Cluster status.                                                                                                                                         |
| `SW_INSPECT`               | The Inspect page — every `/api/inspect/*` call returns `404 inspect_not_enabled` and the page renders an actionable banner instead of the board.                                                                                                            |

The "Backend unreachable" / `oap_unreachable` banners you see in
Studio when a selector is missing are honest reports — Studio is
running fine, the upstream just isn't exposing the path. Set the
selector + restart OAP and the page recovers on the next poll.

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
