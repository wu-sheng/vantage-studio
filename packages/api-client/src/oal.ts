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
 * Read-only OAL management API — `GET /runtime/oal/*` introduced by
 * SWIP-13 §4.1. The OAL debugger's rule picker is the primary
 * consumer; operators also use it to browse what `.oal` content the
 * cluster has loaded.
 *
 * **Read-only by design.** OAL hot-update (add / update / inactivate /
 * delete) is a much larger feature with classloader-isolation and
 * cluster-coordination concerns; it is out of scope here and a future
 * SWIP. The path prefix `/runtime/oal/*` is reserved so write
 * endpoints can land additively.
 *
 * The `contentHash` field on every file/rule snapshot is the same
 * SHA-256 the live debugger stamps on captured records — UI matches
 * `record.contentHash` against this hash to render the right YAML
 * alongside captures.
 */

import { RuntimeRuleApiError, type ApplyResult } from './types.js';
import type { FetchLike } from './runtime-rule.js';

export type OalFileStatus = 'LOADED' | 'DISABLED' | 'COMPILE_FAILED';

/** Filter clause as parsed by the OAL grammar. */
export interface OalFilterSnapshot {
  /** Source-side expression, e.g. `endpoint.name` or
   *  `endpoint.serviceName`. */
  left: string;
  /** Operator symbol — `==`, `!=`, `like`, `in`, etc. */
  op: string;
  /** Right-hand side as written in the rule (string-literal,
   *  numeric, list literal, …). */
  right: string;
}

export interface OalRuleSnapshot {
  /** OAL file (without extension), e.g. `core`. */
  file: string;
  /** Rule name as written in the file, e.g. `endpoint_cpm`. */
  ruleName: string;
  /** 1-based line number in the `.oal` file where the rule starts. */
  line: number;
  /** Source scope as a Java-style class name, e.g. `Endpoint`. */
  sourceScope: string;
  /** Verbatim rule expression (one logical line, may span physical
   *  lines in the source). */
  expression: string;
  /** Aggregation function — `cpm`, `longAvg`, `apdex`,
   *  `percentile`, etc. */
  function: string;
  /** Filter clauses in source order. Empty when the rule has no
   *  `.filter(...)` chain. */
  filters: OalFilterSnapshot[];
  /** The metric name the rule persists under, e.g.
   *  `endpoint_cpm`. Usually equal to `ruleName` but may differ if
   *  the OAL parser rewrites it. */
  persistedMetricName: string;
  /** SHA-256 of the file's content, hex-encoded lowercase (64
   *  chars). Same hash the live debugger stamps on captured records;
   *  used to correlate captures with the rule version that produced
   *  them. */
  contentHash: string;
}

export interface OalFileListing {
  name: string;
  path: string;
  ruleCount: number;
  status: OalFileStatus;
  contentHash: string;
}

export interface OalFileDetail {
  name: string;
  path: string;
  /** Raw `.oal` text. */
  content: string;
  rules: OalRuleSnapshot[];
  status: OalFileStatus;
  contentHash: string;
}

export interface OalClientOptions {
  /** OAP admin-server URL, e.g. `http://oap:17128`. No trailing slash. */
  adminUrl: string;
  fetch?: FetchLike;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Typed wrapper for the four read-only OAL endpoints SWIP-13 §4.1
 * adds to admin-server. Mirrors the shape of `RuntimeRuleClient` so
 * callers can wire a single fetch impl across both.
 */
export class OalClient {
  private readonly fetchImpl: FetchLike;
  private readonly base: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: OalClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.base = options.adminUrl.replace(/\/$/, '');
    this.defaultHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 0;
  }

  /** `GET /runtime/oal/files` — one row per loaded `.oal` file. */
  async listFiles(): Promise<OalFileListing[]> {
    const url = `${this.base}/runtime/oal/files`;
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as OalFileListing[];
  }

  /** `GET /runtime/oal/files/{name}` — file + parsed rules + raw
   *  text. Returns `null` when the file isn't loaded. */
  async getFile(name: string): Promise<OalFileDetail | null> {
    const url = `${this.base}/runtime/oal/files/${encodeURIComponent(name)}`;
    const res = await this.send(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as OalFileDetail;
  }

  /** `GET /runtime/oal/rules` — flat list across every file. The
   *  picker the OAL live debugger uses. */
  async listRules(): Promise<OalRuleSnapshot[]> {
    const url = `${this.base}/runtime/oal/rules`;
    const res = await this.send(url, { method: 'GET' });
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as OalRuleSnapshot[];
  }

  /** `GET /runtime/oal/rules/{ruleName}` — single rule detail.
   *  Returns `null` when no rule by that name is loaded. */
  async getRule(ruleName: string): Promise<OalRuleSnapshot | null> {
    const url = `${this.base}/runtime/oal/rules/${encodeURIComponent(ruleName)}`;
    const res = await this.send(url, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res, url);
    return (await res.json()) as OalRuleSnapshot;
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
