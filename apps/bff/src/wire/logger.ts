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
 * Wire-level debug log — JSONL capture of every inbound `/api/*`
 * request/response and every outbound BFF→OAP call, with bodies.
 *
 * Off by default. Enable in `studio.yaml`:
 *
 *   debugLog:
 *     enabled: true
 *     file: /data/debug-wire.jsonl
 *     maxBodyChars: 8192
 *     redactAuthHeaders: true
 *
 * Hot-reloadable: flip `enabled` on, run an integration scenario,
 * flip it off — the file is JSONL with one line per inbound or
 * outbound event, sharing a `traceId` so a request and its
 * downstream OAP fan-out are reconstructable.
 *
 * Use case: integration-testing Studio against a real OAP build of
 * SWIP-13. The captured wire content is what diffs against SWIP §1
 * payload tables to spot field-level deviations the formal payload
 * schema doc may pin differently.
 */

import { mkdir } from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export type WireDirection = 'inbound' | 'outbound';

export interface WireEvent {
  /** Per-request correlation id. Inbound + every downstream
   *  outbound for the same request share the same id. */
  traceId: string;
  direction: WireDirection;
  ts: number;
  method: string;
  url: string;
  /** Inbound: client IP if known. Outbound: undefined. */
  fromIp?: string;
  /** Captured request headers (filtered when `redactAuthHeaders`). */
  reqHeaders?: Record<string, string>;
  /** Stringified request body. JSON objects are pretty-printed; raw
   *  text passes through. Truncated at `maxBodyChars` with a
   *  `… +N chars truncated` marker. */
  reqBody?: string;
  /** Set on the response side. */
  status?: number;
  resHeaders?: Record<string, string>;
  resBody?: string;
  /** Wall-clock latency from request to response. */
  durationMs?: number;
  /** Set when the response is a thrown/network error. */
  error?: string;
}

export interface WireLogger {
  /** True iff the logger is currently capturing. Hot-reload flips
   *  this — fast path skips body capture when off. */
  enabled(): boolean;
  /** Truncate strings at this length before they hit the file. */
  maxBodyChars(): number;
  log(event: WireEvent): void;
  /** Flush + close. Important on process exit. */
  close(): Promise<void>;
}

export interface WireLoggerOptions {
  enabled: boolean;
  file: string;
  maxBodyChars: number;
  redactAuthHeaders: boolean;
}

/** Truncate one captured body cell, mirroring the SWIP-13 §5
 *  per-leaf truncation marker. */
export function truncate(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max) + `… +${s.length - max} chars truncated`;
}

const HEADER_REDACT = new Set(['cookie', 'authorization', 'set-cookie', 'x-forwarded-for']);

export function redactHeaders(
  headers: Record<string, string | string[] | undefined> | Headers,
  redactAuth: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  const it: Iterable<[string, string]> =
    headers instanceof Headers
      ? headers
      : (Object.entries(headers).filter(([, v]) => v !== undefined) as [string, string][]).map(
          ([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)],
        );
  for (const [k, v] of it) {
    const lower = k.toLowerCase();
    if (redactAuth && HEADER_REDACT.has(lower)) {
      out[lower] = '<redacted>';
    } else {
      out[lower] = v;
    }
  }
  return out;
}

/**
 * Per-request `traceId` carrier. The Fastify hook sets this on the
 * inbound boundary; the wrapped `fetch` reads it so outbound OAP
 * calls inherit the inbound id.
 */
export const wireContext = new AsyncLocalStorage<{ traceId: string }>();

/** Generate a short hex id. Not cryptographically random — purely
 *  for log correlation. */
export function newTraceId(): string {
  const a = Math.floor(Math.random() * 0xffffffff).toString(16);
  const b = Math.floor(Math.random() * 0xffffffff).toString(16);
  return (a + b).padStart(16, '0');
}

/**
 * Build a file-backed wire logger. The actual `enabled` flag is
 * read on every event so hot-reloading the studio.yaml flag takes
 * effect immediately without restart.
 */
export async function createWireLogger(
  initial: WireLoggerOptions,
  /** Read the current options on every event. Must return the
   *  latest values from the config handle. */
  read: () => WireLoggerOptions,
): Promise<WireLogger> {
  let stream: WriteStream | null = null;
  let currentFile: string | null = null;

  async function ensureStream(file: string): Promise<WriteStream> {
    if (stream && currentFile === file) return stream;
    if (stream) {
      await new Promise<void>((resolve) => stream!.end(() => resolve()));
    }
    await mkdir(dirname(file), { recursive: true });
    stream = createWriteStream(file, { flags: 'a' });
    currentFile = file;
    return stream;
  }

  // Open eagerly when starting enabled so the path is validated.
  if (initial.enabled) {
    await ensureStream(initial.file);
  }

  return {
    enabled(): boolean {
      return read().enabled;
    },
    maxBodyChars(): number {
      return read().maxBodyChars;
    },
    log(event: WireEvent): void {
      const opts = read();
      if (!opts.enabled) return;
      // Lazy-open on first log when the user hot-flipped enabled
      // from false → true.
      void ensureStream(opts.file).then((s) => {
        s.write(JSON.stringify(event) + '\n');
      });
    },
    async close(): Promise<void> {
      if (!stream) return;
      const s = stream;
      stream = null;
      await new Promise<void>((resolve) => s.end(() => resolve()));
    },
  };
}

/** Test/dev logger that captures events in memory. */
export function createMemoryWireLogger(
  opts: Partial<WireLoggerOptions> = {},
): WireLogger & { events: WireEvent[]; setEnabled(v: boolean): void } {
  const events: WireEvent[] = [];
  let enabled = opts.enabled ?? true;
  const max = opts.maxBodyChars ?? 8192;
  return {
    events,
    setEnabled(v: boolean): void {
      enabled = v;
    },
    enabled(): boolean {
      return enabled;
    },
    maxBodyChars(): number {
      return max;
    },
    log(event: WireEvent): void {
      if (!enabled) return;
      events.push(event);
    },
    async close(): Promise<void> {},
  };
}

/** No-op logger. Used when the BFF is built without wire logging. */
export function createNoopWireLogger(): WireLogger {
  return {
    enabled: () => false,
    maxBodyChars: () => 0,
    log: () => {},
    close: async () => {},
  };
}
