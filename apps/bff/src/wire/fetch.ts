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
 * Outbound `FetchLike` wrapper that emits one wire event per
 * BFF→OAP call.
 *
 * Uses `wireContext` (an AsyncLocalStorage carrier) to inherit the
 * inbound request's traceId so a complete request can be
 * reconstructed from the JSONL — `inbound`, then 1+ `outbound`
 * lines, sharing the same `traceId`. When called outside a Fastify
 * request (startup probes, tests), a fresh traceId is minted.
 */

import type { FetchLike } from '@vantage-studio/api-client';
import { newTraceId, redactHeaders, truncate, wireContext, type WireLogger } from './logger.js';

export interface WireFetchOptions {
  redactAuthHeaders: boolean;
}

export function makeWireFetch(
  base: FetchLike,
  wire: WireLogger,
  opts: WireFetchOptions,
): FetchLike {
  return async (input, init) => {
    const start = Date.now();
    const url = input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const traceId = wireContext.getStore()?.traceId ?? newTraceId();
    const max = wire.maxBodyChars();

    let reqHeaders: Record<string, string> | undefined;
    let reqBody: string | undefined;
    if (wire.enabled()) {
      if (init?.headers) {
        reqHeaders = redactHeaders(init.headers as Record<string, string>, opts.redactAuthHeaders);
      }
      reqBody = describeBody(init?.body, max);
    }

    let res: Response;
    try {
      res = await base(input, init);
    } catch (err) {
      if (wire.enabled()) {
        wire.log({
          traceId,
          direction: 'outbound',
          ts: start,
          method,
          url,
          ...(reqHeaders !== undefined ? { reqHeaders } : {}),
          ...(reqBody !== undefined ? { reqBody } : {}),
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
      throw err;
    }

    if (!wire.enabled()) return res;

    /* Tee the response body for logging without consuming the
     * caller's stream. Two safeguards:
     *   - Skip the read entirely for streaming / large content
     *     types (dumps are streamed YAML; binary downloads should
     *     never be buffered through wire log).
     *   - Cap the cloned body read at `max * 4` bytes so a
     *     misclassified large response can't balloon BFF memory.
     *     Without the cap, `cloned.text()` reads the entire body
     *     before `truncate` runs, so the M-byte dump is fully
     *     buffered every time. */
    const resBody = await captureResponseBody(res, max);

    wire.log({
      traceId,
      direction: 'outbound',
      ts: start,
      method,
      url,
      ...(reqHeaders !== undefined ? { reqHeaders } : {}),
      ...(reqBody !== undefined ? { reqBody } : {}),
      status: res.status,
      resHeaders: redactHeaders(res.headers, opts.redactAuthHeaders),
      ...(resBody !== undefined ? { resBody } : {}),
      durationMs: Date.now() - start,
    });

    return res;
  };
}

/** Read up to `max * 4` bytes from a cloned response and truncate to
 *  `max` chars for logging. Returns a marker string for streaming /
 *  binary content types or when reading fails. */
async function captureResponseBody(res: Response, max: number): Promise<string | undefined> {
  const ct = res.headers.get('content-type') ?? '';
  if (looksStreamy(ct)) return `<${ct} response — not captured>`;
  const cl = Number.parseInt(res.headers.get('content-length') ?? '', 10);
  /* The `cloned.text()` call below buffers everything before any
   * truncation, so cap at the read level when the server announces
   * a big payload. */
  const readCap = max * 4;
  if (Number.isFinite(cl) && cl > readCap) {
    return `<${cl}-byte response — capped, not captured>`;
  }
  let cloned: Response;
  try {
    cloned = res.clone();
  } catch {
    return '<unable to clone response>';
  }
  try {
    const reader = cloned.body?.getReader();
    if (!reader) {
      const text = await cloned.text();
      return truncate(text, max);
    }
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let out = '';
    let bytes = 0;
    while (out.length < readCap) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        out += decoder.decode(value, { stream: true });
        if (bytes > readCap) break;
      }
    }
    out += decoder.decode();
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return truncate(out, max);
  } catch {
    return '<binary or unreadable>';
  }
}

function looksStreamy(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('application/x-yaml') ||
    ct.startsWith('text/yaml') ||
    ct.startsWith('application/octet-stream') ||
    ct.startsWith('application/zip') ||
    ct.startsWith('application/gzip') ||
    ct.startsWith('application/x-tar') ||
    ct.startsWith('multipart/')
  );
}

function describeBody(body: unknown, max: number): string | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return truncate(body, max);
  if (body instanceof URLSearchParams) return truncate(body.toString(), max);
  if (body instanceof Uint8Array) return `<binary ${body.byteLength} bytes>`;
  if (body instanceof ArrayBuffer) return `<binary ${body.byteLength} bytes>`;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `<blob ${body.size} bytes>`;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return '<form-data>';
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return '<stream>';
  }
  return '<unknown body>';
}
