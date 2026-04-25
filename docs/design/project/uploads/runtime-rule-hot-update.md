# Runtime Rule Hot-Update — Architecture

Operators change MAL and LAL rule files at runtime without restarting OAP. Changes
persist in management storage, survive reboots, and propagate across every node in an
OAP cluster within a bounded window. This page describes the logic. For the operator
REST reference and CLI walkthrough, see
[Runtime Rule Hot-Update API](../setup/backend/backend-runtime-rule-api.md).

## Vocabulary

- **Runtime rule entry** — the unit of operator state: one entry per `(catalog, name)`,
  carrying the full rule-file content plus a status of `ACTIVE` or `INACTIVE`. Entries
  live in management storage (the same persistence layer used for UI templates, UI
  menus, and other cluster-wide operator state). Every workflow on this page is
  ultimately a read-from or write-to one of these entries.
- **Bundle** — the in-memory representation of one compiled rule file on one node:
  classloader, generated classes, dispatch handlers, current suspension state.
- **Catalog** — one of `otel-rules`, `log-mal-rules`, `lal`. Mirrors the on-disk
  directory layout so a rule's `(catalog, name)` identity is portable between disk and
  the runtime-rule entry store.
- **Main** — the single OAP node designated to run the on-demand workflow. Every node
  can compute it locally from the sorted cluster peer list; no election.
- **Peer** — every node other than the main.

## Three workflows

The feature is three cooperating workflows:

1. **Boot** — OAP starts; static rule files on disk are loaded, with operator-installed
   runtime-rule entries substituted in or tombstoned at load time. Backend schema is
   treated read-only — never reshaped, never dropped.
2. **On-demand** — an operator calls the admin HTTP endpoint to add, update, inactivate,
   or delete a runtime-rule entry. This is the **only** workflow that may change
   backend schema, because the operator explicitly asked for it.
3. **Tick** — every OAP node runs a periodic reconciliation loop (default 30 s) that
   reads every runtime-rule entry and converges its local state to match.

```
                              ┌─────────────────────────┐
                              │   management storage    │ ← runtime-rule entries
                              │  (one entry per file)   │    (ACTIVE / INACTIVE)
                              └─────────────────────────┘
                                 ▲                ▲
                                 │ write          │ read
                                 │                │
  ┌─── boot ───┐         ┌── on-demand ──┐    ┌── tick (30 s) ──┐
  │ static     │         │ admin HTTP    │    │ reconciler      │
  │ files      │         │ add / update  │    │ diff entries    │
  │ on disk    │         │ inactivate    │    │ vs in-memory    │
  │    │       │         │ delete        │    │ bundle snapshot │
  │    ▼       │         │    │          │    │    │            │
  │ override   │         │    ▼          │    │    ▼            │
  │ substitute │         │ per-file      │    │ apply deltas    │
  │ or skip    │         │ lock → diff   │    │ in lex order    │
  │    │       │         │ → suspend     │    │                 │
  │    ▼       │         │ broadcast →   │    │ self-heal sweep │
  │ compile +  │         │ DDL → verify  │    │ loader-gc sweep │
  │ register   │         │ → persist →   │    │                 │
  │ create-if- │         │ activate      │    │ main: full      │
  │ absent     │         │               │    │ peer: local-    │
  │            │         │               │    │ cache-only      │
  └────────────┘         └───────────────┘    └─────────────────┘
```

Each workflow interacts with the backend under one of three **install modes**:

- **create-if-absent** — create absent resources; skip with an ERROR log on shape
  mismatch; never update, never drop. Used by the boot workflow.
- **full-install** — full DDL including reshape and drop. Used by the on-demand
  operator workflow, and by the main-node tick when an entry differs from local state.
- **local-cache-only** — no server RPCs; populate local caches only. Used by the
  peer-node tick.

The mode distinction is what keeps boot and peer paths from making backend schema
changes: only explicit operator action through the on-demand workflow ever reshapes or
drops.

## Boot workflow

At boot each analyzer module scans its rule directory on disk as today. A new
extension point lets the runtime-rule plugin intercept each file before it is compiled.

The sequence inside one OAP process:

1. Core module bootstraps; the runtime-rule entity is registered for persistence
   alongside every other managed entity (UI templates, UI menus, etc.), and the
   management storage backend materialises whatever it needs to hold those entries.
   **This happens before any analyzer loads static rules**, so the extension queries
   below are safe.
2. A classpath scan discovers runtime-rule extension implementations and installs a
   process-wide handle the rule loaders can consult. The runtime-rule plugin contributes
   one implementation; when the plugin is not deployed, the handle stays empty and rule
   loaders fall back to the legacy "read file, compile" path.
3. Analyzer modules start. For each static rule file the loader:
   - Reads the file bytes from disk.
   - Asks the extension what to do with this `(catalog, name)`.
   - Proceeds with whatever bytes the extension returns, or skips the file entirely if
     the extension returns "tombstone".
4. The runtime-rule extension, on its first call, does **one** read that pulls every
   runtime-rule entry into an in-memory map keyed by `catalog:name`. Subsequent calls
   are pure cache hits. The cache is per-process; later runtime changes are picked up
   by workflows 2 and 3, not this hook.
5. Extension decision per file:
   - No entry → use disk bytes (static file loads as-is).
   - `ACTIVE` entry → use the entry's content in place of the disk file.
   - `INACTIVE` entry → skip the file; the operator has tombstoned the rule.
6. Compiled bundles register through the metric system under **create-if-absent**
   semantics. The backend installer creates missing resources; if a resource already
   exists with a shape that differs from what the rule declares, the installer records
   a shape-mismatch outcome, logs an ERROR, and does not touch the backend. The metric
   continues booting in a degraded state until the operator reconciles via the on-demand
   workflow.
7. Receivers open ingress. The reconciler schedule (workflow 3) begins ticking.

### Why boot cannot reshape the backend

Under full-install semantics, a boot that encounters shape drift would silently update
the BanyanDB measure or the ES mapping. Before this change that behaviour was: BanyanDB
and JDBC silently accepted drift (data was written against a schema that no longer
matched, producing truncation or runtime errors later), and Elasticsearch could
hard-fail boot on a strict-mapping type conflict. The create-if-absent rule unifies
these behaviours: drift is always surfaced as an explicit ERROR, boot always continues,
the affected metric is disabled until the operator acts.

### Why a substitution extension instead of a "skip static and register later" path

Overrides have to be live before receivers open, otherwise there is a window where
ingest hits static-shape workers persisting samples into a backend that holds the
override shape. A substitution at load time fuses boot and override registration into
one step; no second "register overrides" pass is needed, and the reconciler's timed
tick handles only post-boot drift.

## On-demand workflow

Triggered by an HTTP call to the runtime-rule admin endpoint. The **structural path**
(below) applies when the change alters metric identity — a metric added, removed,
function changed, scope changed, LAL `(layer, ruleName)` set changed. Pure body changes
(same metrics, different expressions or filters) take a simpler **filter-only path**
that swaps compiled artefacts locally and persists without cluster coordination.

Non-main-node requests are forwarded to the main over the cluster bus before the work
starts; the node that actually runs the workflow below is always the current main.

### Structural path, step by step

1. **Lock the file.** A per-file reentrant lock serializes concurrent applies for the
   same `(catalog, name)`. Unrelated files proceed in parallel.
2. **Classify the delta.** Compare the incoming rule file against the currently-applied
   bundle on this node. Filter-only diffs short-circuit to the fast path. Structural
   diffs continue below.
3. **Compile the new bundle** under a fresh per-file classloader and Javassist class
   pool. Compile failure aborts the workflow with an HTTP 400 and no side effects.
4. **Local suspend.** Remove dispatch handlers for the affected metrics on this node and
   drain their L1 / L2 batch queues so in-flight samples either land on old handlers or
   are cleanly dropped. Record the bundle as suspended with origin `SELF`. The previous
   bundle's classloader is retained so a rollback can snap it back without recompile.
5. **Broadcast suspend** to every peer over the cluster bus. Peers perform the same
   local suspend on receipt and record origin `PEER`. The broadcast is fire-and-forget
   with a short deadline; unreachable peers log a warning but do not block the
   workflow — they will self-recover via workflow 3.
6. **Apply DDL and register the new bundle** on this node under full-install mode. The
   metric system creates classes for new metrics, removes stale ones for retired
   metrics, and the backend installer runs whatever DDL is implied (BanyanDB
   `deleteMeasure` / `define`, ES `createIndex`, JDBC `CREATE TABLE IF NOT EXISTS`).
7. **Verify.** Re-query the backend via each model's existence check and confirm the
   live shape matches what the rule declares. Polls briefly to cover metadata-propagation
   latency. If verify fails the workflow aborts, reinstalls the old bundle locally, and
   returns HTTP 500; peers self-heal within a minute because the runtime-rule entry
   was never advanced (see workflow 3).
8. **Persist.** Upsert the runtime-rule entry with the new content and
   `status=ACTIVE`. **This is the cluster-wide commit point.** Until this write
   succeeds, peers that received the suspend broadcast stay suspended on the old
   bundle; afterwards their next tick sees the new content.
9. **Finalize.** Unregister metrics that existed in the old bundle but not the new;
   swap the bundle pointer; retire the old classloader to the loader graveyard for GC
   observation; fire an alarm-kernel reset for the affected metric names so alarm
   windows do not carry accumulator values across a metric-identity change.
10. **Respond 200** with a short summary of what changed.

Filter-only path is a subset: steps 3, 4 (minus drain), 8, and a local swap; no broadcast,
no DDL, no alarm reset.

### Lifecycle contract

An operator-managed rule moves through three observable states:

```
  [absent] ──/addOrUpdate──► ACTIVE ──/inactivate──► INACTIVE ──/delete──► [absent]
                                ▲                         │
                                └─────/addOrUpdate────────┘   (reactivate)
```

The three endpoints split the destructive and the cleanup work:

- **`/addOrUpdate`** is the only way to *enter* `ACTIVE`. It handles both "new rule" and
  "reactivate" uniformly — a post against an `INACTIVE` entry runs the full structural
  pipeline exactly like a post against an absent entry, so the backend schema and
  dispatch handlers are re-created from the posted content. Same-content posts against
  an `INACTIVE` entry are treated as a reactivation (not a no-op) because the entry's
  status is what matters, not the bytes.
- **`/inactivate`** is the destructive path. It broadcasts `Suspend`, flips the entry
  status to `INACTIVE`, and runs the full teardown locally — dispatch handlers removed,
  BanyanDB measure dropped via `dropTable`, alarm windows reset. Peers observe the
  `INACTIVE` status on their next tick and run the same teardown. The backend is fully
  torn down after `/inactivate` completes; only the `INACTIVE` tombstone entry remains.
- **`/delete`** is a row-only cleanup. It refuses to operate on an `ACTIVE` entry —
  returns `HTTP 409 requires_inactivate_first` so destructive work never sneaks in
  through the delete path. On an `INACTIVE` entry it is just a management-storage row
  removal under the per-file lock: no `Suspend` broadcast, no DDL, no verification,
  because `/inactivate` already did all of that. On an absent entry it is an idempotent
  200 `not_found`.

Why split it this way: every destructive step is concentrated on `/inactivate`, so the
rollback story ("reactivate via `/addOrUpdate`") is uniform regardless of whether the
rule was ever deleted. `/delete` becomes a cheap finalization that cannot corrupt
cluster state even if it races with tick-driven reconciliation — there is no live
bundle to race against once the entry is `INACTIVE`.

If a static version of the rule exists on disk, `/delete` of the runtime tombstone
causes the rule to revert to the static content on the next reconciler tick. This is
the intended recovery path for "undo all operator state, go back to what ships in the
OAP distribution".

## Tick workflow

Runs on a single-thread scheduled executor, default 30 s interval, started after every
module has finished its own boot. The tick:

1. Fetches every runtime-rule entry from management storage.
2. Sorts the entries lexicographically by `(catalog, name)`. This is load-bearing for
   LAL: cross-file rule-name collisions within a layer are rejected at apply time, and
   if two peers processed the same set of files in different orders they could accept
   different sides of the collision and diverge. Sorting eliminates the split.
3. Diffs the entries against an in-memory snapshot keyed by `(catalog, name)` and
   classifies each differing bundle.
4. Applies each delta under the appropriate install mode — full-install if this node is
   the current main, local-cache-only otherwise (see Distributed cluster model below).
5. **Missed-broadcast recovery** — if a peer sees a content change for a bundle it is
   still running with the old content (the suspend broadcast never arrived because of
   a partition or RPC failure), the peer logs a warning, self-suspends, and re-registers
   the new bundle in local-cache-only mode. The peer trusts the main's committed entry
   as authoritative — the main already ran DDL and post-apply verification before
   persisting, so re-verifying here would duplicate work and cannot produce a more
   trustworthy answer. The peer's own local registration still checks shape consistency
   against the backend metadata cache; a mismatch is recorded and surfaced on `/list`.
6. **Self-heal sweep** — every bundle that has been suspended with origin `PEER` for at
   least the self-heal threshold (60 s by default) and whose entry content still
   matches the bundle's pre-suspend hash is un-suspended back to the retained old
   bundle. This is the recovery path when a main node broadcast suspend but crashed
   before persisting. The threshold uses a monotonic clock so wall-time jumps cannot
   fire or delay it incorrectly.
7. **Loader-graveyard sweep** — drains confirmed garbage collections of retired
   per-file classloaders; raises a once-per-loader warning for any retired loader still
   pending after five minutes, the leak signal.

### Consistency bounds

| Event                                                         | Convergence bound                                                            |
|---------------------------------------------------------------|------------------------------------------------------------------------------|
| Healthy structural commit                                     | ≤ 30 s for every peer (one tick).                                            |
| Main aborts mid-structural (after broadcast, before persist)  | ≤ 60 s (peer self-heal).                                                     |
| Main crashes mid-structural                                   | ≤ 60 s.                                                                      |
| Suspend RPC dropped to one peer                               | ≤ 30 s (missed-broadcast recovery).                                          |
| Peer partitioned during apply, rejoins later                  | ≤ 30 s after rejoin.                                                         |
| Two operators applying the same file to different nodes       | Last write wins; cluster converges within 30 s of the second commit.         |
| Management storage unavailable                                | In-memory state held stable; resumes within ≤ 30 s of storage return.        |

Formally: every node's in-memory bundle for a given `(catalog, name)` either equals
the current runtime-rule entry's content, or it is suspended and in the process of
transitioning toward it. No CAS, no quorum, no leader election.

## Distributed cluster model

The feature runs on any OAP cluster coordinator (Zookeeper / Kubernetes / Standalone /
Etcd / Nacos) without adding a coordinator of its own. Cluster coordination relies on:

- The authoritative runtime-rule entry as the **single writer of truth**.
- A **deterministic single-main** every node can compute locally.
- A **single-direction suspend broadcast** plus a 60 s self-heal to cover abort paths.

### Single main, selected from the sorted peer list

Every OAP already knows the sorted list of peers through the cluster module; the first
peer in that list is designated "the runtime-rule main" by convention. Every node reads
the same sorted list, so every node agrees on the same main without talking to each
other. The main changes only when the lexicographically-first node joins or leaves the
cluster, which is infrequent.

A single main cluster-wide (rather than a hash-based main-per-file) was chosen because
runtime-rule writes are rare — a handful of operator pushes per day on a typical
cluster. Distributing writes across nodes buys no throughput, and a single main makes
"two mains for the same file" a hard impossibility under correct routing; its
observable symptom would immediately signal split-brain without per-file analysis.

### REST requests are forwarded to the main

A call arriving at any node checks whether the receiver is the current main. If yes it
proceeds locally. If not, it forwards to the main through the cluster bus; the main
runs the workflow and the edge node returns the main's response to the operator. A
narrow ping-pong guard returns HTTP 421 Misdirected Request if a forwarded request
arrives at a node that also believes it is not the main — this can happen only during a
brief topology flip between two nodes' views of the sorted peer list.

### Suspend broadcast

The main's structural workflow broadcasts `Suspend(catalog, name, sender_id, issued_at)`
to every peer, iterated per peer with a short per-peer deadline (2 s, configurable).
A peer that does not ack within the deadline is logged and skipped; the fanout does not
block waiting for it. Unreachable peers self-recover via the 60 s self-heal rule.

The `Suspend` RPC is paired with a `Resume(catalog, name, sender_id, issued_at)` RPC
that the main broadcasts when a structural apply has to be rolled back before the
persist step completes — e.g., local DDL failed, persist failed, or the main detected a
split-brain `409 origin_conflict` from a peer during the `Suspend` fanout. `Resume`
unsticks peers from the parked state within one RPC round-trip instead of waiting on
the 60 s self-heal window. If the `Resume` broadcast itself fails to reach a peer, the
peer still self-heals on the threshold — `Resume` is a best-effort shortcut, not a new
primitive that peers depend on.

Receive semantics are idempotent:

- Bundle not present locally → ack "not present"; main continues.
- Bundle already suspended (by an earlier broadcast or a local apply) → ack "already
  suspended"; no state change. Duplicate sends and self-loops are both safe.
- Sender ID equals this node's ID → ack "already suspended"; suppresses self-loop
  amplification.
- Bundle running → drain L1/L2 for the bundle's metrics, remove dispatch handlers,
  stamp the bundle with suspension origin `PEER` and the current monotonic time, keep
  the old classloader alive so a main-side abort can roll back cleanly.

### Suspension origin lattice

A bundle that is suspended carries an **origin** that records why:

- `SELF` — this node's own REST handler entered suspend immediately before its
  structural apply. Cleared by the handler's own commit-or-failure path.
- `PEER` — a peer main's suspend broadcast parked this bundle. Cleared either by the
  main's committed entry arriving on the next tick, or by the self-heal rule.
- `BOTH` — under correct single-main routing this value is unreachable. Its appearance
  signals split-brain. The transition logic handles it anyway so the lattice is total.

Origins compose — when both origins are set, clearing one flips the bundle to the
other; clearing both returns it to running. Every origin transition refreshes the
monotonic stamp used by the self-heal threshold, so "how long has this been PEER-only"
is measured independently from "how long has this been suspended at all". Without this
refresh a bundle whose origin churned from `SELF` through `BOTH` to `PEER` could
trigger premature self-heal against a clock that started when the bundle was first
SELF-suspended.

### Peer reconciliation — three paths

Every tick, every peer walks its diff and classifies each differing bundle into one
of three paths:

- **Clean catch-up** — peer is suspended with origin `PEER`, the runtime-rule entry now
  carries the content the main committed. Apply in local-cache-only mode: compile,
  populate local caches, register dispatch handlers, transition to running. This is the
  healthy post-commit path.
- **Missed-broadcast recovery** — peer is still running the old bundle (broadcast was
  dropped), the entry now carries new content. Log a warning, self-suspend, drain,
  register the new bundle in local-cache-only mode. The peer trusts the main's committed
  entry: the main already ran DDL and verify before persisting, so re-running verify on
  the peer would duplicate work against the same backend metadata without improving
  correctness. The peer's own local registration surfaces any shape mismatch via
  `/list`, so operators still have visibility into backend drift this node observed.
- **Self-heal to old** — peer is suspended with origin `PEER`, parked past the
  threshold, and the entry's content still equals the pre-suspend hash. The main never
  committed. Clear `PEER`, revert to the retained old bundle, log the event with the
  age elapsed.

All three paths apply DDL only through the local-cache-only mode; peers never write
DDL to the backend. Only the main does.

### Concurrent same-file writes to different nodes

Two operators writing the same file to different nodes at the same instant:

- Under stable topology, only one node is the main; the other forwards. The main
  serializes both requests via its per-file lock. Both run sequentially; the second
  writer's content wins the committed entry.
- Under a brief topology flip where two nodes both believe they are the main, both
  start their own workflow locally. Each acquires its own per-file lock and begins the
  `Suspend` fanout. Split-brain is detected in the fanout: when a peer receives a
  `Suspend` for a bundle it is already `SELF`-suspended on (because its own operator
  issued a structural apply concurrently), the peer returns `REJECTED_ORIGIN_CONFLICT`.
  The main that sees this ack aborts its own workflow, broadcasts `Resume` to the peers
  that already parked, and returns `HTTP 409 split_brain_detected` to the operator.
  The surviving workflow — the one whose peer fanout saw no conflicts — runs to
  completion and commits normally.

The loser-side operator sees `HTTP 409 split_brain_detected` with the offending peer's
node ID in the response body. This is the signal to serialize retries externally; the
cluster's committed state is never ambiguous.

**Cluster convergence is also guaranteed independent of the 409 handshake.** Even if
the split-brain detection missed a timing window and both workflows had reached commit
(each to its own local state, both with HTTP 200), the tick workflow would still
resolve the divergence. Last write on the runtime-rule entry stands, and on the next
reconciler tick every node reads the authoritative entry, classifies its local bundle
as stale, and converges to the committed content via the normal tick paths — structural
apply if the shape differs, filter-only swap if not. Within one tick the cluster is
uniform. The 409 is an **operator-feedback optimisation**, not a correctness gate:
without it the system still converges, but the losing operator would have no signal
that their change was overwritten short of inspecting `/runtime/rule/list`.

### Network partitions and topology changes

- **Peer isolated, re-joins later** — on rejoin its tick sees the current entries and
  applies from scratch. No suspended state to heal from; it was never reachable during
  the partition. Convergence: ≤ 30 s after rejoin.
- **Main isolated** — operators hitting peers get forwarded to an unreachable main and
  see timeouts. The cluster keeps serving on the last-committed bundle; no runtime
  change happens during the partition. Operators retry after the partition heals.
- **Management storage unavailable** — the reconciler tick logs per-tick failures and
  retries; in-memory state held stable. No false suspensions. Resumes within one tick
  of storage returning.
- **Node join** — new node starts empty; its first tick applies every runtime-rule
  entry with its own role (main if lexicographically first, peer otherwise). Static
  files load through the boot workflow exactly as on any other node.
- **Main leaves** — next-lexicographically-first peer becomes the new main on the
  subsequent peer-list refresh, which every node observes consistently. In-flight
  applies on the leaving main do not complete; any peers they suspended self-heal to
  their pre-suspend content within 60 s.

### Cross-version cluster

If OAP binaries across the cluster differ in version, their shipped static-rule
content differs. Runtime-rule entries behave consistently cluster-wide because every
node's extension substitutes the same stored content. Non-overridden static rules
diverge along the version split — this is outside the scope of the feature; the fix is
deployment discipline.

### Load-bearing invariants

Six invariants together carry the distributed contract:

- **Deterministic single-main** — every node reaches the same answer by inspecting its
  own sorted peer list, with no negotiation.
- **Idempotent suspend RPC** — safe under retries, duplicate broadcasts, self-loops,
  and split-brain recovery.
- **Separate `SELF` vs `PEER` origin tracking** — peer self-heal must never clear a
  `SELF` origin that belongs to the main's own in-flight apply.
- **Monotonic clock for self-heal** — wall-clock jumps cannot fire or delay self-heal
  incorrectly. The stamp refreshes on every origin transition so duration is measured
  at the current effective origin.
- **Lexicographic sort before applying deltas** — LAL cross-file collision rejection
  is deterministic across nodes; every peer reaches the same accept/reject partition.
- **Only the main writes DDL** (peers use local-cache-only) — double-writes to the
  backend are structurally impossible regardless of timing.

## Cross-cutting invariants

### Install-mode gating

The three install modes (create-if-absent / full-install / local-cache-only) are the
single gate through which every backend interaction flows. Every caller picks a mode
once and threads it through the listener chain; every backend installer branches on
the mode. Boot and static-registration paths use create-if-absent. The on-demand REST
path uses full-install. The peer-side tick uses local-cache-only. No caller bypasses
the gate.

Shape-mismatch handling lives inside the create-if-absent branch of each installer:
when the backend already holds the resource with a different shape, the installer
records a mismatch outcome, logs an ERROR with the declared-vs-backend diff, and
returns without touching the backend. Operators reconcile explicitly via the on-demand
workflow; the feature never silently reshapes a schema.

### Per-file classloader isolation

Every runtime-managed rule file gets its own classloader and its own Javassist class
pool. Three artifact families live there: the compiled MAL or LAL expression
subclass, any closure companion classes the DSL emits, and the storage-side metric
subclass the metric system generates for each new metric. When the bundle is retired
all three families drop together, the loader becomes phantom-reachable, and the
loader graveyard observes its collection.

A loader that the JVM does not collect within a threshold (default five minutes) is
logged once as a leak suspect. The once-per-loader discipline prevents a stuck loader
from flooding logs across thousands of reconciler ticks; when the loader is finally
collected the entry is removed and a future leak of a different loader for the same
file gets its own fresh warning.

### Lock topology

Four kinds of locks participate in writes. They are always acquired in the order
below, never reversed:

1. Per-file reentrant lock (one per `(catalog, name)`).
2. Metric-system monitor (brief; one class build or one registry drop).
3. Storage-model registry lock (released before firing listener callbacks so listener
   DDL can take unbounded time without blocking unrelated registrations).
4. Backend installer internal locks (JDBC data source, BanyanDB client semaphores).

The ingest hot path — sample dispatch from receivers to workers — is lock-free; it
reads the dispatch map through concurrent-safe structures so a structural apply never
stalls the main ingest path.

### Alarm-kernel reset

Every successful structural apply, every inactivate, and every delete fires a reset
against the alarm kernel for the affected metric names. Matching alarm rules take
their per-window lock, clear accumulated values, reset state-machine counters to
`NORMAL`, and drop any pending fired-alarm message. Alarm state does not carry across
a metric-identity change.

Filter-only changes intentionally do **not** reset alarm state. The identity of the
metric is stable under a filter-only diff; the window's accumulated values remain
comparable to the new samples.

## For developers

The entry points for code navigation are the `runtimerule` receiver plugin's
package-level Javadoc and the class-level Javadoc on the reconciler and the REST
handler; between them they name every major component referenced above. The
install-mode contract lives on the `StorageManipulationOpt` class; the extension
interface and classpath-scan loader live in the core storage model package; the
per-file classloader and loader graveyard live in the runtime-rule plugin's
`classloader` package. Reading `Reconciler`'s class Javadoc top-to-bottom is the
fastest way to build a mental model of the tick logic.
