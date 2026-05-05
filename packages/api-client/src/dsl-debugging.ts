/*
 * Copyright 2026 The Vantage Studio Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * DSL live-debugger client — `/dsl-debugging/*` endpoints, typed against
 * the **actual wire shape** emitted by `DSLDebuggingRestHandler.java` on
 * the `swip-13-dsl-debugger` branch (not the SWIP-13 design tables, which
 * the implementation diverged from).
 *
 *   POST   /dsl-debugging/session?catalog=&name=&ruleName=&clientId=
 *                                             body (optional JSON):
 *                                             { recordCap?, retentionMillis? }
 *   GET    /dsl-debugging/session/{id}
 *   POST   /dsl-debugging/session/{id}/stop
 *   GET    /dsl-debugging/sessions             — JSON object, not NDJSON
 *   GET    /dsl-debugging/status               — 5-field health snapshot
 *
 * **Wire-shape facts that diverge from the SWIP design tables:**
 *
 * - Inputs are query params, not a JSON body.
 * - No `granularity`, no `blocks?[]`, no `windowSec`, no `maxRecords`. The
 *   caps are `recordCap` (default 1000) and `retentionMillis` (default 5 min).
 * - Session response is one union shape with a single `records[]` whose
 *   entries discriminate via the `stage` field. There is no per-DSL
 *   response type or `granularity`/`reason`/`ruleSnapshots` envelope.
 * - Peer ack values are UPPERCASE enum names
 *   (`INSTALLED|NOT_LOCAL|ALREADY_INSTALLED|REJECTED|FAILED`).
 * - Cluster cleanup of a prior session under the same clientId is
 *   surfaced as `priorCleanup[]` (per-peer with `stoppedSessionIds[]`),
 *   not a single `replacedPriorId`.
 * - No truncation markers on overflow — recordCap just freezes the session.
 */

import { RuntimeRuleApiError, type ApplyResult } from './types.js';
import type { FetchLike } from './runtime-rule.js';

// ── Catalogs ───────────────────────────────────────────────────────

/** Debug-session catalog — every wire name accepted by the handler.
 *  Matches `Catalog.java` enum's `wireName` values. */
export type DebugCatalog = 'otel-rules' | 'log-mal-rules' | 'telegraf-rules' | 'lal' | 'oal';

export const DEBUG_CATALOGS: readonly DebugCatalog[] = [
  'otel-rules',
  'log-mal-rules',
  'telegraf-rules',
  'lal',
  'oal',
] as const;

export function isDebugCatalog(value: unknown): value is DebugCatalog {
  return typeof value === 'string' && (DEBUG_CATALOGS as readonly string[]).includes(value);
}

// ── Session start ──────────────────────────────────────────────────

/** Query-param inputs (mandatory) for `POST /dsl-debugging/session`. */
export interface StartSessionQuery {
  /** Stable per-debug-context UUID. UI mints one per browser tab /
   *  debugger widget into sessionStorage and reuses it across polls. */
  clientId: string;
  catalog: DebugCatalog;
  /** For LAL: file name with extension (e.g. `default.yaml`); for
   *  runtime-rule-applied LAL the upstream uses the rule name as both
   *  `name` and `ruleName`.
   *  For MAL: the rule's `name` from `/runtime/rule/list`.
   *  For OAL: source class name (e.g. `Endpoint`). */
  name: string;
  /** For LAL: the rule within the file (or the rule name for
   *  runtime-rule LAL).
   *  For MAL: the metric's full name (matches the holder lookup key).
   *  For OAL: the source class name (same value as `name`). */
  ruleName: string;
  /** Per-DSL capture granularity. Currently only LAL distinguishes
   *  block vs statement; MAL/OAL ignore the flag server-side.
   *  Defaults to `block`. */
  granularity?: Granularity;
}

/** Optional JSON body for `POST /dsl-debugging/session`. */
export interface StartSessionBody {
  /** Default 1000. Session moves to `captured` once this many records
   *  have been appended. */
  recordCap?: number;
  /** Default 5 min. Wall-clock retention before the session is reaped. */
  retentionMillis?: number;
}

/** LAL-only knob — does the recorder also emit per-statement `line`
 *  records, or just the block stages (text / parser / extractor /
 *  outputRecord / outputMetric). Server query param wins over body. */
export type Granularity = 'block' | 'statement';

export const GRANULARITIES: readonly Granularity[] = ['block', 'statement'] as const;

export function isGranularity(v: unknown): v is Granularity {
  return v === 'block' || v === 'statement';
}

export type StartSessionArgs = StartSessionQuery & StartSessionBody;

/** Per-peer install ack from the `InstallDebugSession` fan-out. */
export interface PeerInstallAck {
  peer: string;
  /** Set when the peer responded. */
  nodeId?: string;
  ack: 'INSTALLED' | 'NOT_LOCAL' | 'ALREADY_INSTALLED' | 'REJECTED' | 'FAILED';
  detail?: string;
}

/** Per-peer cleanup outcome from the `StopByClientId` fan-out. The
 *  receiving node also runs its local cleanup and reports it. */
export interface PriorCleanupOutcome {
  peer: string;
  nodeId?: string;
  stoppedCount?: number;
  stoppedSessionIds?: string[];
  /** Set instead of the success fields when the peer call failed. */
  ack?: 'failed';
  detail?: string;
}

export interface RuleKey {
  catalog: DebugCatalog;
  name: string;
  ruleName: string;
}

export interface StartSessionResponse {
  sessionId: string;
  clientId: string;
  ruleKey: RuleKey;
  /** Unix-ms. */
  createdAt: number;
  /** Unix-ms. The session is reaped at this wall-clock. */
  retentionDeadline: number;
  /** Echoed back from the request (or the server default `block`). */
  granularity: Granularity;
  peers: PeerInstallAck[];
  priorCleanup: PriorCleanupOutcome[];
}

// ── Per-DSL stage names + payload shapes ───────────────────────────

/** Every stage name a `record.stage` can carry. The wire union covers
 *  all three DSLs; client code switches on it to pick a payload type. */
export type Stage =
  // MAL
  | 'input'
  | 'filter'
  | 'stage'
  | 'scope'
  | 'downsample'
  | 'meterBuild'
  | 'meterEmit'
  // LAL
  | 'text'
  | 'parser'
  | 'extractor'
  | 'outputRecord'
  | 'outputMetric'
  | 'line'
  // OAL
  | 'source'
  | 'build'
  | 'aggregation'
  | 'emit';

/** MAL non-terminal payload (input / filter / stage / scope / downsample).
 *  `extra.kept` only on `filter`; `extra.entities` only on `scope`. */
export interface MalSamplesPayload {
  samples?: number;
  empty?: boolean;
  extra?: { kept?: boolean; entities?: number };
}

/** MAL terminal payload (meterBuild / meterEmit). `valueType` only on
 *  meterBuild; `timeBucket` only on meterEmit. */
export interface MalMeterPayload {
  metric: string;
  valueType?: string;
  entity: string;
  value: string;
  timeBucket?: number;
}

/** LAL block-stage payload — text / parser / extractor / outputRecord
 *  / outputMetric. The upstream emits these flat (no `sourceLine`
 *  wrapper) because block stages aren't tied to a single statement;
 *  the verbatim `record.sourceText` is the locator. */
export interface LalBlockPayload {
  aborted?: boolean;
  hasOutput?: boolean;
  hasParsed?: boolean;
  extra?: {
    /** `outputRecord` only — concrete builder class name. */
    outputClass?: string;
    /** `outputMetric` only — sample count handed to MAL. */
    samples?: number;
  };
}

/** LAL line-stage payload — only the `line` stage carries this shape,
 *  and only when the session was started with `granularity=statement`.
 *  `sourceLine` is 1-based and identifies the exact DSL statement that
 *  fired. The body re-uses `LalBlockPayload` for consistency. */
export interface LalLinePayload {
  sourceLine: number;
  body: LalBlockPayload;
}

/** OAL source / filter payload. */
export interface OalSourcePayload {
  type: string;
  scope?: number;
  extra?: { kept?: boolean };
}

/** OAL build / aggregation / emit payload. */
export interface OalMetricsPayload {
  type: string;
  timeBucket: number;
}

export type RecordPayload =
  | MalSamplesPayload
  | MalMeterPayload
  | LalBlockPayload
  | LalLinePayload
  | OalSourcePayload
  | OalMetricsPayload;

/** A single captured probe sample. The `stage` field discriminates the
 *  `payload` shape — see the per-DSL payload types above.
 *
 *  No per-record timestamp: probes fire at clock-tick speed and array
 *  order preserves intra-slice ordering. The session response carries
 *  one top-level `capturedAt` stamped when the slice was snapshotted. */
export interface SessionRecord {
  stage: Stage;
  /** Verbatim DSL fragment from ANTLR's input stream. For MAL chain
   *  stages this is the full call form `sum(['service_name', 'step'])`,
   *  not just `sum`; for OAL filter records it's `filter(detectPoint
   *  == DetectPoint.SERVER)` etc. — byte-for-byte matchable against
   *  the source. LAL block stages use pseudo-fragments (`"raw"`,
   *  `"parsed"`, `"fields"`) since those probes don't correspond to a
   *  single DSL line. */
  sourceText: string;
  /** SHA-256 hex of the rule content the holder was bound to. Stable
   *  per holder; a hot-update mid-session creates a new holder with a
   *  new hash, and pre-update records keep the old hash so the UI can
   *  render the matching rule version. */
  contentHash: string;
  payload: RecordPayload;
}

// ── Per-node slice + session response ──────────────────────────────

export type NodeStatus = 'ok' | 'captured' | 'not_local' | 'unreachable';

export interface NodeSlice {
  /** Set on the local slice and on successful peer slices. */
  nodeId?: string;
  /** Set on peer slices (the gRPC peer address); always present for
   *  unreachable peers, may also appear on healthy ones. */
  peer?: string;
  status: NodeStatus;
  captured?: boolean;
  totalBytes?: number;
  records: SessionRecord[];
  /** Set when `status === 'unreachable'`. */
  detail?: string;
}

export interface SessionResponse {
  sessionId: string;
  /** Unix-ms when the receiving node snapshotted the slice. Replaces
   *  the per-record `capturedAt` that earlier wire revisions carried —
   *  one stamp per snapshot is enough since records are appended at
   *  clock-tick speed and array order preserves intra-slice ordering. */
  capturedAt: number;
  nodes: NodeSlice[];
}

// ── Stop / list / status ───────────────────────────────────────────

export interface StopPeerOutcome {
  peer: string;
  nodeId?: string;
  stopped?: boolean;
  ack?: 'failed';
  detail?: string;
}

export interface StopSessionResponse {
  sessionId: string;
  localStopped: boolean;
  peers: StopPeerOutcome[];
}

export interface ActiveSessionRow {
  sessionId: string;
  clientId: string;
  ruleKey: RuleKey;
  createdAt: number;
  retentionDeadline: number;
  captured: boolean;
  totalBytes: number;
}

export interface ActiveSessionsResponse {
  sessions: ActiveSessionRow[];
  count: number;
}

export interface DslDebuggingStatus {
  module: string;
  phase: string;
  nodeId: string;
  injectionEnabled: boolean;
  activeSessions: number;
}

// ── Error envelope ─────────────────────────────────────────────────

/** Known `code` values the handler emits. Open string for forward
 *  compatibility — the server may extend this enum. */
export type DebugErrorCode =
  | 'injection_disabled'
  | 'invalid_catalog'
  | 'missing_param'
  | 'rule_not_found'
  | 'registry_misconfigured'
  | 'source_not_found'
  | 'missing_source'
  | (string & {});

export interface DebugErrorBody {
  status: 'error';
  code: DebugErrorCode;
  message: string;
}

// ── Client ─────────────────────────────────────────────────────────

export interface DslDebuggingClientOptions {
  adminUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class DslDebuggingClient {
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: DslDebuggingClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = options.adminUrl.replace(/\/$/, '');
    this.defaultHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 0;
  }

  /** `POST /dsl-debugging/session?catalog=&name=&ruleName=&clientId=
   *  [&granularity=]`, optional JSON body with `recordCap` /
   *  `retentionMillis`. The query param wins over the body for
   *  granularity (matches upstream resolution order). */
  async startSession(args: StartSessionArgs): Promise<StartSessionResponse> {
    const params = new URLSearchParams({
      catalog: args.catalog,
      name: args.name,
      ruleName: args.ruleName,
      clientId: args.clientId,
    });
    if (args.granularity !== undefined) params.set('granularity', args.granularity);
    const url = `${this.base}/dsl-debugging/session?${params.toString()}`;
    const body: StartSessionBody = {};
    if (args.recordCap !== undefined) body.recordCap = args.recordCap;
    if (args.retentionMillis !== undefined) body.retentionMillis = args.retentionMillis;
    const hasBody = Object.keys(body).length > 0;
    const init: RequestInit = {
      method: 'POST',
      ...(hasBody
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    };
    const res = await this.send(url, init);
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as StartSessionResponse;
  }

  /** `GET /dsl-debugging/session/{id}`. Returns `null` only on a
   *  network 404 (the handler itself doesn't 404 — a missing session
   *  surfaces as `nodes[0].status: "not_local"`). */
  async getSession(id: string): Promise<SessionResponse | null> {
    const url = `${this.base}/dsl-debugging/session/${encodeURIComponent(id)}`;
    const res = await this.send(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as SessionResponse;
  }

  /** `POST /dsl-debugging/session/{id}/stop` — idempotent. */
  async stopSession(id: string): Promise<StopSessionResponse> {
    const url = `${this.base}/dsl-debugging/session/${encodeURIComponent(id)}/stop`;
    const res = await this.send(url, { method: 'POST' });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as StopSessionResponse;
  }

  /** `GET /dsl-debugging/sessions` — JSON object, not NDJSON. */
  async listSessions(): Promise<ActiveSessionsResponse> {
    const url = `${this.base}/dsl-debugging/sessions`;
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as ActiveSessionsResponse;
  }

  /** `GET /dsl-debugging/status` — per-node 5-field health snapshot. */
  async getStatus(): Promise<DslDebuggingStatus> {
    const url = `${this.base}/dsl-debugging/status`;
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as DslDebuggingStatus;
  }

  // ── private helpers ─────────────────────────────────────────────

  private async send(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const finalInit: RequestInit = { ...init, headers };
    if (this.timeoutMs > 0) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.fetchImpl(url, { ...finalInit, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
    return this.fetchImpl(url, finalInit);
  }

  private async toError(res: Response, url: string): Promise<RuntimeRuleApiError> {
    const text = await res.text();
    let parsed: ApplyResult | string = text;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      // Accept either the legacy `{ applyStatus, message }` envelope
      // (runtime-rule pipeline) or the new `{ status, code, message }`
      // envelope (dsl-debugging / runtime-oal). The downstream
      // `outcomeOf` helper switches on `code` or `applyStatus` so we
      // pass the raw JSON through under the union type.
      if (typeof json.applyStatus === 'string' && typeof json.message === 'string') {
        parsed = json as unknown as ApplyResult;
      } else if (
        json.status === 'error' &&
        typeof json.code === 'string' &&
        typeof json.message === 'string'
      ) {
        parsed = json as unknown as ApplyResult;
      }
    } catch {
      // not JSON; keep the raw text.
    }
    return new RuntimeRuleApiError(res.status, parsed, url);
  }
}
