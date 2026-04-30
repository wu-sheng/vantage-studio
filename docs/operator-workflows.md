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
