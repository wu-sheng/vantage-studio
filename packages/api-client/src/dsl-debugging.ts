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
 * DSL live-debugger client — `/dsl-debugging/*` endpoints introduced
 * by SWIP-13 §4.2. Five public REST endpoints plus per-DSL response
 * shapes derived from §1's tables.
 *
 *   POST   /dsl-debugging/session           — start (auto-stops prior session for this clientId cluster-wide)
 *   GET    /dsl-debugging/session/{id}      — poll aggregated payload
 *   POST   /dsl-debugging/session/{id}/stop — force close
 *   GET    /dsl-debugging/sessions          — list active (NDJSON)
 *   GET    /dsl-debugging/status            — injection / runtime posture
 *
 * The `clientId` is per-debug-context (UI mints a UUID per browser
 * tab/widget into sessionStorage). A new POST with the same clientId
 * triggers a cluster-scope `StopByClientId(clientId)` broadcast so
 * the prior session is terminated wherever it lived — load-balancer
 * safe.
 *
 * The `contentHash` field that appears on every captured record is
 * the same SHA-256 returned by `/runtime/rule/list` and
 * `/runtime/oal/rules`. UI matches `record.contentHash` against
 * `ruleSnapshots[hash].content` to render the right YAML alongside
 * captures, even when a rule was hot-updated mid-session.
 *
 * **Watch-items at integration time** (see `reference_swip13.md`):
 *
 * - `replacedPriorId` may carry a single string under correct routing
 *   or potentially be plural under a load-balancer split — accept
 *   either shape.
 * - The terminal `reason` enum is a string — `record_cap` /
 *   `window_elapsed` / `manual_stop` / `bytes_cap` are the four
 *   currently-known values.
 * - Per-DSL response field names follow SWIP §1 tables; the formal
 *   schema doc lands with the OAP merge.
 */

import { RuntimeRuleApiError, type ApplyResult } from './types.js';
import type { FetchLike } from './runtime-rule.js';

// ── Catalogs the debug-session API accepts ──────────────────────────

/** Debug-session catalog union — the runtime-rule catalogs plus
 *  `oal` for OAL sessions. Note: `oal` is **not** valid for the
 *  runtime-rule management endpoints. */
export type DebugCatalog = 'otel-rules' | 'log-mal-rules' | 'lal' | 'oal';

export const DEBUG_CATALOGS: readonly DebugCatalog[] = [
  'otel-rules',
  'log-mal-rules',
  'lal',
  'oal',
] as const;

export function isDebugCatalog(value: unknown): value is DebugCatalog {
  return typeof value === 'string' && (DEBUG_CATALOGS as readonly string[]).includes(value);
}

// ── Session lifecycle ──────────────────────────────────────────────

export type SessionStatus = 'capturing' | 'captured' | 'expired';

/** Open string with the four currently-documented values. The OAP
 *  side may extend the enum; treat unknown values as opaque
 *  identifiers. */
export type TerminalReason =
  | 'record_cap'
  | 'window_elapsed'
  | 'manual_stop'
  | 'bytes_cap'
  | (string & {});

export type Granularity = 'block' | 'statement';

/** LAL block kinds the operator can toggle on/off via `blocks?[]`
 *  on the session POST. Per SWIP §1 LAL section. */
export type LalBlock =
  | 'text'
  | 'parser'
  | 'extractor'
  | 'sink'
  | 'output_record'
  | 'output_metric';

// ── Session start request/response ─────────────────────────────────

export interface StartSessionArgs {
  /** Stable per-debug-context UUID. UI mints one per browser tab /
   *  debugger widget into sessionStorage and reuses it across polls. */
  clientId: string;
  catalog: DebugCatalog;
  /** Rule name for MAL/LAL; OAL `.oal` file name (without extension)
   *  for OAL. */
  name: string;
  /** Required for OAL only; the rule-line picked from
   *  `/runtime/oal/rules`. */
  ruleName?: string;
  /** LAL only — restrict capture to specific block kinds. Default:
   *  all blocks. */
  blocks?: LalBlock[];
  /** Override the per-DSL record cap. */
  maxRecords?: number;
  /** Override the capture window. */
  windowSec?: number;
  /** LAL only. `block` (default) or `statement` (one cell per
   *  meaningful DSL statement). */
  granularity?: Granularity;
}

export interface PeerInstallAck {
  nodeId: string;
  ack: 'ok' | 'install_failed' | 'timeout';
}

export interface StartSessionResponse {
  sessionId: string;
  /** Unix-ms. */
  expiresAt: number;
  /** Present when a prior session for this `clientId` was found and
   *  terminated. SWIP allows either a single id or potentially an
   *  array under a load-balancer split — accept either shape. */
  replacedPriorId?: string;
  /** Reserved for the load-balancer-split scenario. */
  replacedPriorIds?: string[];
  /** Per-peer install acks. The receiving node aggregates these from
   *  the InstallDebugSession fan-out. */
  peers: PeerInstallAck[];
}

// ── Per-DSL capture shapes (SWIP §1) ───────────────────────────────

/** Truncation marker that may appear in any cap-bounded array
 *  (samples, labels, meterEntities). The exact wire shape is not
 *  formally enumerated by SWIP-13; this matches the documented
 *  "+N more" summary convention. Tolerant by design — UI must
 *  detect either shape. */
export interface TruncationMarker {
  /** When the wire emits a string entry like `"+12 more"`. */
  truncated?: number;
  /** When the wire emits an object entry. */
  more?: number;
  note?: string;
}

/** A single captured Sample row in MAL stages or OAL source. */
export interface SampleSnapshot {
  /** Free-form labels → values (numbers and strings both possible
   *  depending on the underlying source). */
  labels?: Record<string, string | number>;
  value?: number | string;
  /** Raw timestamp when the source row carries one (ms). */
  timestamp?: number;
  /** Generic catch-all so future fields don't break the type. */
  [key: string]: unknown;
}

export interface MeterEntitySnapshot {
  entityId?: string;
  scopeType?: string;
  layer?: string;
  name?: string;
  instance?: string;
  endpoint?: string;
  /** Final value at meter_emit. */
  value?: number | string | unknown;
  [key: string]: unknown;
}

export type MalStageKind =
  | 'filter'
  | 'input'
  | 'closure'
  | 'op'
  | 'scope'
  | 'tag'
  | 'downsampling'
  | 'meter_build'
  | 'meter_emit';

export type MalMeterValueType =
  | 'Long'
  | 'DataTable'
  | 'BucketedValues'
  | 'PercentileArgument';

/** Per SWIP §1 MAL table. Each captured stage is one of these. */
export interface MalStageRecord {
  id: string;
  kind: MalStageKind;
  label?: string;
  detail?: string;
  /** 1-based YAML line. May repeat across consecutive chain stages
   *  emitted from the same folded-scalar `exp:` field. */
  sourceLine?: number;
  sourceText?: string;
  inCount?: number;
  outCount?: number;
  dropped?: number;
  samples?: (SampleSnapshot | TruncationMarker)[];
  /** Set on `meter_build` / `meter_emit` only. */
  meterValueType?: MalMeterValueType;
  meterEntities?: (MeterEntitySnapshot | TruncationMarker)[];
  /** Only set on `downsampling` rows. */
  downsampling?: { function: string; origin: 'explicit' | 'default' };
  /** SHA-256 of the rule content that emitted this record. */
  contentHash?: string;
}

/** LAL capture — per SWIP §1 LAL section. */
export interface LalSinkInfo {
  branch?: 'enforcer' | 'sampler' | 'rateLimit' | 'pass-through' | (string & {});
  kept?: boolean;
  note?: string;
}

export interface LalOutputRecord {
  /** Concrete builder class name — `LogBuilder`,
   *  `EnvoyAccessLogBuilder`, etc. */
  outputType?: string;
  /** Populated bean state, free-form per builder subclass. */
  builderState?: Record<string, unknown>;
}

export interface LalOutputMetric {
  /** SampleFamily handed to MAL. */
  sampleFamily?: unknown;
}

export interface LalRecord {
  id: string;
  ts?: number;
  svc?: string;
  body_type?: 'json' | 'yaml' | 'text' | 'none' | (string & {});
  text?: string;
  parsed?: unknown;
  extracted?: Record<string, unknown>;
  def_vars?: Record<string, unknown>;
  sink?: LalSinkInfo;
  output_record?: LalOutputRecord | null;
  output_metric?: LalOutputMetric | null;
  /** Statement-level row; null/absent in `block` mode. */
  sourceLine?: number;
  contentHash?: string;
}

/** OAL capture — per SWIP §1 OAL table. */
export type OalStageKind = 'source' | 'filter' | 'build_metrics' | 'aggregation' | 'emit';

export interface OalFilterDecision {
  left?: string;
  op?: string;
  right?: string;
  kept?: boolean;
}

export interface OalStageRecord {
  id: string;
  kind: OalStageKind;
  /** Set for user-written clauses (`source` / `filter` /
   *  `aggregation`); absent for compiler-implicit stages
   *  (`build_metrics` / `emit`). */
  sourceLine?: number;
  sourceText?: string;
  /** Set on `source` rows. */
  source?: SampleSnapshot;
  /** Set on `filter` rows. */
  filter?: OalFilterDecision;
  /** Set on `build_metrics` / `aggregation` / `emit`. The concrete
   *  Metrics class name + its populated state. */
  metricsClass?: string;
  metricsState?: Record<string, unknown>;
  contentHash?: string;
}

// ── Per-node slice + session response ──────────────────────────────

export interface NodeSliceBase {
  nodeId: string;
  status: 'ok' | 'install_failed' | 'timeout' | 'node_unreachable' | 'injection_disabled' | (string & {});
}

export interface MalNodeSlice extends NodeSliceBase {
  records?: MalStageRecord[];
}

export interface LalNodeSlice extends NodeSliceBase {
  records?: LalRecord[];
}

export interface OalNodeSlice extends NodeSliceBase {
  records?: OalStageRecord[];
}

export interface RuleSnapshot {
  contentHash: string;
  capturedFirstAt?: number;
  /** Rule YAML / `.oal` text matching `contentHash`. */
  content: string;
}

interface SessionResponseBase {
  sessionId: string;
  status: SessionStatus;
  /** Why the session moved to CAPTURED. Absent while still
   *  capturing. */
  reason?: TerminalReason;
  expiresAt: number;
  /** Map keyed by SHA-256 contentHash. */
  ruleSnapshots: Record<string, RuleSnapshot>;
  /** When granularity flag is reflected back from the server. */
  granularity?: Granularity;
}

export interface MalSessionResponse extends SessionResponseBase {
  catalog: 'otel-rules' | 'log-mal-rules';
  name: string;
  nodes: MalNodeSlice[];
}

export interface LalSessionResponse extends SessionResponseBase {
  catalog: 'lal';
  name: string;
  nodes: LalNodeSlice[];
}

export interface OalSessionResponse extends SessionResponseBase {
  catalog: 'oal';
  name: string;
  ruleName: string;
  nodes: OalNodeSlice[];
}

export type SessionResponse = MalSessionResponse | LalSessionResponse | OalSessionResponse;

// ── Status (SWIP §3.9) ─────────────────────────────────────────────

export interface DslDebuggingStatus {
  adminHostEnabled: boolean;
  dslDebuggingEnabled: boolean;
  injectionEnabled: boolean;
  injectionEnabledSource?: string;
  sessionsAcceptingNewRequests: boolean;
  activeSessions: number;
  maxActiveSessions: number;
  ruleClassesWithProbes: number;
  ruleClassesTotal: number;
}

// ── Active session listing ─────────────────────────────────────────

export interface ActiveSessionRow {
  sessionId: string;
  clientId: string;
  catalog: DebugCatalog;
  name: string;
  ruleName?: string;
  status: SessionStatus;
  startedAt: number;
  expiresAt: number;
}

// ── Client ─────────────────────────────────────────────────────────

export interface DslDebuggingClientOptions {
  /** OAP admin-server URL, e.g. `http://oap:17128`. No trailing slash. */
  adminUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Typed wrapper for the five public DSL-debugging REST endpoints.
 */
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

  /** `POST /dsl-debugging/session`. Cluster-scope cleanup of any prior
   *  session for this clientId fires before allocation. */
  async startSession(args: StartSessionArgs): Promise<StartSessionResponse> {
    const url = `${this.base}/dsl-debugging/session`;
    const res = await this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as StartSessionResponse;
  }

  /** `GET /dsl-debugging/session/{id}`. Returns `null` when the
   *  session has expired. */
  async getSession(id: string): Promise<SessionResponse | null> {
    const url = `${this.base}/dsl-debugging/session/${encodeURIComponent(id)}`;
    const res = await this.send(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as SessionResponse;
  }

  /** `POST /dsl-debugging/session/{id}/stop`. Idempotent. */
  async stopSession(id: string): Promise<void> {
    const url = `${this.base}/dsl-debugging/session/${encodeURIComponent(id)}/stop`;
    const res = await this.send(url, { method: 'POST' });
    if (!res.ok && res.status !== 404) throw await this.toError(res, url);
  }

  /** `GET /dsl-debugging/sessions` — NDJSON of active sessions.
   *  Buffered and split on the BFF; client returns the parsed array. */
  async listSessions(): Promise<ActiveSessionRow[]> {
    const url = `${this.base}/dsl-debugging/sessions`;
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) throw await this.toError(res, url);
    const text = await res.text();
    if (!text.trim()) return [];
    return text
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ActiveSessionRow);
  }

  /** `GET /dsl-debugging/status`. Per-node — for cluster-wide
   *  posture, the BFF fans out across `oap.adminUrls`. */
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
      const json = JSON.parse(text) as Partial<ApplyResult>;
      if (typeof json.applyStatus === 'string' && typeof json.message === 'string') {
        parsed = json as ApplyResult;
      }
    } catch {
      // not JSON; keep the raw text.
    }
    return new RuntimeRuleApiError(res.status, parsed, url);
  }
}
