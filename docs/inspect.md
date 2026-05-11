<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Inspect

The **Inspect** page lets you browse OAP's metric catalog, pick which
entity (service / instance / endpoint / relation) holds values for a
given metric, and chart the MQE series — all in one place, five
widgets per row by default.

It binds to two upstream surfaces:

| Studio route                   | Calls                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `GET  /api/inspect/catalog`    | admin `GET /inspect/metrics` + Studio's MAL/OAL rule attribution     |
| `GET  /api/inspect/entities`   | admin `GET /inspect/entities?metric=…&start=…&end=…&step=…&limit=…`  |
| `GET  /api/inspect/mqe-target` | admin `GET /debugging/config/dump` (resolves the MQE base URL)       |
| `POST /api/inspect/exec`       | resolved MQE base — `mutation execExpression(expression, entity, …)` |

Inspect is admin-only on the OAP side; the catalog and entity routes
live on the admin-server port `17128`. The MQE-fire route goes to the
public REST / sharing-server surface (default `12800`), discovered at
runtime.

## Prerequisites

- **OAP 10.5.0+** with these selectors set:
  ```env
  SW_ADMIN_SERVER=default
  SW_INSPECT=default
  ```
  When `SW_INSPECT` is unset, the inspect page renders a banner with
  the exact command to run.
- Studio configured to reach OAP — see [`configure.md`](configure.md).
- Operator role with the `inspect:read` verb (or `*`).

## The page

### Toolbar

- **range** — `start` / `end` / `step` (MINUTE / HOUR / DAY). The
  date format adapts to the step: `yyyy-MM-dd` for DAY, `yyyy-MM-dd HH`
  for HOUR, `yyyy-MM-dd HHmm` for MINUTE. Switching the step resets
  the range to a sensible default.
- **board cap** — soft cap on widget count. Default 10. Each widget
  fires its own MQE call; the cap exists to keep an over-eager
  operator from drowning the query surface.
- **inspector top-n** — per-widget entity cap passed as
  `limit=` to `/inspect/entities`. Default 10. The server-side hard
  cap is 300.
- **per row** — 1 / 3 / 5 widgets per row. Chart height grows when
  the density is lower.

### MQE target

Shows the resolved MQE base URL and a short rationale, e.g.
`sharing-server.restPort, admin URL host (sharing-server.restHost was wildcard)`.

To override (typical for k8s ingress setups where admin and REST
hostnames differ), set `oap.mqe.host` and/or `oap.mqe.port` in
`studio.yaml`:

```yaml
oap:
  adminUrls:
    - http://oap-admin.cluster.local:17128
  statusUrl: http://oap.cluster.local:12800
  mqe:
    host: rest-gateway.cluster.local # both fields independent
    port: 12800
```

Each `mqe.*` field is independently optional. The BFF discovers any
missing piece from `/debugging/config/dump`:

1. If `oap.mqe.host` is unset, use `sharing-server.restHost` from the
   dump, preferring it over `core.restHost`. If the bound host is
   `0.0.0.0` / wildcard, fall back to the admin URL's host.
2. If `oap.mqe.port` is unset, use `sharing-server.restPort` if the
   sharing-server module is enabled; otherwise `core.restPort`.

The resolved value is cached BFF-side for 60s. Click **refresh** in
the page header to bust the cache, re-read `/debugging/config/dump`,
and re-pull the catalog.

### Catalog drawer

Click **+ add metric** to open the catalog. Layout is two-pane:

- **Left**: rule files grouped by source — `OAL`, `MAL · OTEL`,
  `MAL · Telegraf`, `LAL → MAL`, plus an `unknown` bucket for
  metrics Studio couldn't attribute (rare; happens when a metric
  appears in `/inspect/metrics` but no `.oal` / MAL rule Studio
  reads declared it). Per-file badge: scope when single, otherwise
  scope count. Click a file to load its metrics; click `+ all` next
  to a file to select every MQE-queryable metric in it.
- **Right**: metric rows for the active file with a regex search,
  per-row checkbox, and the metric type pill. HEATMAP and
  SAMPLED_RECORD rows are visible but disabled — `/inspect/entities`
  only handles `REGULAR_VALUE` and `LABELED_VALUE` per SWIP-14.

The breadcrumb has `select all N` / `clear` shortcuts when bulk
selection is what you actually want.

### Widget

Each metric on the board renders one card:

- **Header** — metric name, source pill, scope (entity-type) pill,
  chart toggle (`line` ⇄ `bar` ⇄ `area`), remove.
- **Entity bar** — `◀` / `▶` cycle through the entities
  `/inspect/entities` returned, top-1 selected by default (the most
  recent per SWIP-14's sort order, so the most likely to have data).
  Click the entity button to open the editor.
- **Entity editor** — three sections:
  1. **Resolved** — multi-select over the entities the inspect API
     returned.
  2. **Custom** — entities you added by hand (form-built, not JSON).
  3. **Form** — scope-aware fields. For `Service` it's just
     `serviceName` + `normal`. For `ServiceRelation` it's
     `serviceName` / `normal` + `destServiceName` / `destNormal`.
     Endpoint / Instance / \*Relation scopes get the right field
     set automatically — the metric's scope is fixed, you only
     fill in the names.
  4. The chart re-fires for every selection change.
- **Chart** — ECharts, single series when one entity is selected,
  multi-series when more. For `LABELED_VALUE` metrics with multiple
  entities, Studio falls back to one representative label per entity
  to keep the chart readable; pick one entity to see all labels.

### Refresh

The header **refresh** button does three things in order:

1. Hits the BFF with `?refresh=true` on `/api/inspect/catalog` and
   `/api/inspect/mqe-target` so the BFF re-pulls the underlying
   admin endpoints and rebuilds its attribution index.
2. Invalidates the vue-query cache for every `['inspect', …]` key.
3. Re-resolves entities and re-fires MQE for every widget on the
   board.

Use it after you've edited a MAL/OAL rule in another tab — the
catalog drawer will pick up the new metric attribution without a
page reload.

## RBAC

Add `inspect:read` to whichever role the operator has. With RBAC
disabled (the default), every authenticated user can use Inspect.

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
        - rule:debug
        - cluster:read
        - inspect:read # ← required for the Inspect page
    viewer:
      verbs:
        - rule:read
        - cluster:read
        - inspect:read # read-only inspectors get it too
```

## Troubleshooting

| Symptom                                            | Likely cause                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Banner: "Inspect API not enabled on OAP"           | `SW_INSPECT` is unset / empty on OAP. Set `SW_INSPECT=default` and restart OAP.             |
| MQE target shows "unresolved"                      | `/debugging/config/dump` failed (admin-server not reachable, status module disabled, etc.). |
| Widget says "no values in range"                   | The picked entity has no MQE values in `[start, end]`. Widen the range or pick another.     |
| Widget error "unknown metric: …"                   | Metric was removed between catalog fetch and exec fire. Refresh the page.                   |
| Catalog drawer shows metric under `unknown` source | Metric is in `/inspect/metrics` but not in any OAL file or MAL rule Studio reads.           |

For deeper debugging, enable Studio's `debugLog` (see
[`configure.md`](configure.md)) to capture both inbound `/api/*` calls
and every BFF→OAP egress with shared trace IDs.
