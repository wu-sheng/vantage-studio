<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Operator workflows

Five common paths through Studio's UI. Every action below has an
audit-log entry so post-incident review is straightforward — see
[`auth.md`](auth.md) for the JSONL format.

## Push a rule (filter-only edit)

1. Sign in.
2. Pick the catalog from the left nav (e.g. **MAL · OTEL**).
3. Click the rule card to open the editor.
4. Edit the YAML in Monaco. Autocomplete suggests MAL/LAL keywords
   based on the catalog.
5. Click **save**. The header shows `filter_only_applied` (no DDL,
   no alarm window reset) on a body-only edit.

If OAP rejects the save with `storage_change_requires_explicit_approval`,
Studio pops up a **typed-name confirm** that surfaces what's about to
happen verbatim from the upstream warning text. Type the rule name
to arm the confirm, click **confirm**, and Studio re-pushes with
`allowStorageChange=true`. Header transitions to `structural_applied`.

## Recover from a broken push

A previous push left the rule in a broken state — the cluster matrix
shows a red `err` hover on a node, or the editor's banner says the
last apply failed.

1. Open the editor for the rule.
2. Open the **advanced** disclosure under the editor.
3. Tick **recovery: `force=true` on save** (visible only to users with
   `rule:write:structural`).
4. Edit the YAML to a known-good state if the previous push was
   semantically wrong, or leave it as-is if you just want OAP to
   re-run apply on byte-identical content.
5. Save. Studio sends `force=true` (and `allowStorageChange=true`
   under the typed-name confirm if the recovery is a schema change).

`force=true` subsumes the old `/fix` route. The audit row records
`{action: "addOrUpdate", verb: "rule:write:structural", details:
{force: true, allowStorageChange: …}}`.

## Inspect cluster convergence

The **Cluster status** page (left nav) shows a per-rule × per-node
matrix from the BFF's fan-out of `/runtime/rule/list` to every
configured admin URL. Refreshes every 5 s; click **refresh now** to
poll immediately.

What to look for:

- The **converged** column. `no` means at least two nodes hold
  different `contentHash` for the same rule, or a node is missing the
  rule entirely. The default sort surfaces these first.
- A **suspended** pill in any cell means that node is mid-structural-
  apply. Transient — usually clears within one tick (~30 s).
- Per-cell **err** hover shows the node's last apply error.
- The header **N with errors** pill counts rules that any node
  reports a `lastApplyError` for. The default sort puts these first.

A node with `ok: false` (the per-node strip up top has the cell in
red with the BFF's captured error) usually means an unreachable OAP
admin URL — check `oap.adminUrls` against your actual cluster.

## Take a dump

The **Dump & restore** page (left nav) has four buttons:

- **dump all catalogs** — pulls the entire ruleset.
- **dump · otel-rules** / **log-mal-rules** / **lal** — per-catalog.

Each button triggers a same-origin download of a `tar.gz` with the
following layout:

```
runtime-rule-dump/
  manifest.yaml                       # dumpedAt, sha256 + status + updateTime per row
  <catalog>/<name>.yaml               # ACTIVE rows
  inactive/<catalog>/<name>.yaml      # INACTIVE rows
```

The archive is re-postable through `/runtime/rule/addOrUpdate` for
manual restore. Studio doesn't have a one-click **restore** in v1 —
the upstream API isn't there yet — but the page has a disabled
restore card that explains the manual loop.

## Inactivate vs. delete vs. revert-to-bundled

Three different "off" semantics; Studio surfaces the difference.

| Action                | Effect                                                                                                                                                                                                                                                                    | When to use                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Inactivate**        | Tear down runtime registrations, leave `localState=NOT_LOADED`. The row stays INACTIVE in storage; intent persists across reboots. Doesn't touch backend resources.                                                                                                       | Pause a rule. Re-activate by editing + saving (auto-rehydrates) or by deleting (which reverts to bundled if a bundled twin exists). |
| **Delete** (default)  | Drops the runtime row. Backend resource is **left as an inert artefact** — no schema change, no measure dropped. Returns `409 requires_inactivate_first` if the row is still ACTIVE.                                                                                      | Remove a rule entirely from the operator's runtime view.                                                                            |
| **Revert to bundled** | `/delete?mode=revertToBundled`. Runs the standard apply pipeline against the bundled YAML — **this is a schema change**. Runtime-only metrics that the bundled rule doesn't define are dropped from BanyanDB. Returns `400 no_bundled_twin` if no bundled version exists. | Roll back to the shipped default.                                                                                                   |

Studio's default-delete button is just a button. The
**revert-to-bundled** button (only shown when the rule has a bundled
twin) opens the typed-name confirm with the upstream warning text —
the only delete path that runs a schema change in v1.

## Browse OAL rules (read-only)

The **OAL catalog** page (left nav) lists every `.oal` file the OAP
cluster has loaded plus every rule line within each file. Pure
read-only — OAL hot-update is intentionally not in scope; Studio
just surfaces what is loaded.

For each file: name, path, rule count, status (`LOADED` /
`DISABLED` / `COMPILE_FAILED`), and `contentHash`. For each rule:
file, rule name, line, source scope, expression, function name,
filters, and the persisted metric name. The `contentHash` is the
same SHA-256 the live debugger stamps on captured records — UI
matches captures to rule content via this hash.

## Live debugger (MAL · LAL · OAL)

The **Live debugger** page (under **Live debugger** in the left
nav) lets operators sample the actual data flowing through a rule's
DSL pipeline on demand. Pick a rule, hit **start sampling**, watch
records arrive live as polls land. The session auto-stops when the
record cap fires (default + hard cap **100** per
`SessionLimits.MAX_RECORD_CAP`) or the retention window elapses
(default 5 min, hard cap 1 hour); operators can also stop manually.

Three views, one per DSL — the wire emits unified samples (`input |
filter | function | aggregation | output`) and each view shapes them
to fit the DSL's mental model:

- **MAL** — per-record card with a rule-meta strip (`metric` /
  `filter` / `exp` / `suffix`) and a 3-column stage grid
  (`label · rail · rows-table`) per step. The right pane lists every
  `MalSampleRow` as `name | labels | value` (capped at 50 rows;
  empty families render verbatim). Click a step to highlight the
  matching expression `<mark>`'d in the rule strip above. The output
  meter renders only what the wire serialises today: `metric`,
  `function`, `value` (when present — scalar `number`,
  `string` for non-finite, or `Record<string, number>` for
  histogram-percentile / `*Labeled`), and `timeBucket`. The entity
  is shown in a separate card with null-field collapse + `show all`
  toggle.
- **LAL** — per-record × per-block matrix. Records are columns,
  block samples are rows. In statement-mode the function row splits
  per `sourceLine` and the row label carries the verbatim DSL slice
  (`tag stage: 'extractor'` …); block-mode collapses to one row
  labelled `extractor`. A **search** field filters records whose log
  body / content / tags contain the substring; a **show first** cap
  (default 20, max 100) keeps the grid scannable when the recorder
  hits 100. A foldable side pane on the left renders the captured
  rule body line-by-line — each line with a matching `function`
  sample carries a `▶` jump-to-row hook (red ▶ for the block-mode
  extractor anchor). Click a record's `⤢` to expand it to a
  full-width single-record view; `← matrix` returns.
- **OAL** — per-record card with a 3-column stage grid like MAL.
  The right pane renders every primitive field of the OAL source /
  metric payload as `key=value`, with the IDManager `entityId` /
  `entity_id` (and metric `id` = `<timeBucket>_<entityId>`)
  annotated with their decoded forms next to the raw value. The
  decoder is at [`apps/ui/src/views/debug/oalEntityId.ts`](../apps/ui/src/views/debug/oalEntityId.ts);
  it mirrors OAP's `IDManager` + `Layer` mapping so `Y2hlY2tvdXQ=.1`
  reads as `(checkout · real)`, a Service-Relation id reads as
  `(checkout (real) → catalog (real))`, and so on.

Per-cluster coverage shows up as a strip above the capture: each
peer's install ack (`installed` / `already_installed` / `failed` /
`timeout`). Captures during a hot-update keep the rule's
`contentHash` on every record, so the matrix preserves which rule
content emitted which row.

### Capture history (browser-local)

Every session's wire payloads are auto-mirrored into browser
`localStorage` (key `vs:debug-history:v1`) on each poll, so closing
the tab or losing the connection doesn't lose the capture. The
**Capture history** page (sibling nav entry) lists every entry
across all three DSLs with a filter chip-row:

- **Active** entries (retention deadline still in the future) carry
  a `live` badge and a 1 Hz countdown; **resume →** routes to
  `/debug/{widget}?resumeSessionId=<sessionId>` which reattaches
  polling without re-allocating a session on OAP.
- **Completed** entries (deadline passed or operator stopped)
  route via `/debug/{widget}?historyId=<entryId>` for read-only
  replay — the per-DSL view renders the captured snapshot exactly
  as it was, with an amber "viewing saved capture" banner and a
  back-to-live button.

Storage is capped per-widget at 20 entries (oldest dropped on
overflow / quota error). Nothing leaves the browser; history is
local-only and operator-isolated.

The **Cluster status** page surfaces a per-node DSL-debugging health
strip: whether bytecode probes are injected, how many sessions are
active, and the active-session ceiling. Useful for confirming the
feature is enabled on every node before opening a session.
