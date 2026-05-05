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
 * Fastify hooks that capture `/api/*` request and response bodies
 * into the wire log, and run every handler inside an
 * `AsyncLocalStorage` context so the wrapped `fetch` inherits the
 * request's `traceId`.
 *
 * Login bodies are explicitly redacted — they carry passwords.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  newTraceId,
  redactHeaders,
  truncate,
  wireContext,
  type WireLogger,
} from './logger.js';

export interface RegisterWireHookOptions {
  /** Mirrors `studio.yaml.debugLog.redactAuthHeaders`. */
  redactAuthHeaders: () => boolean;
}

/** Path patterns whose request body must never appear in the log
 *  (passwords, secrets, etc.). Response bodies for these paths are
 *  still logged because they are status / role envelopes the
 *  operator may want to debug. */
const REQ_BODY_BLOCKLIST: RegExp[] = [/^\/api\/auth\/login$/];

declare module 'fastify' {
  interface FastifyRequest {
    wireTraceId?: string;
    wireStart?: number;
  }
}

export function registerWireHook(
  app: FastifyInstance,
  wire: WireLogger,
  opts: RegisterWireHookOptions,
): void {
  app.addHook('onRequest', (req, _reply, done) => {
    if (req.url.startsWith('/api/')) {
      req.wireTraceId = newTraceId();
      req.wireStart = Date.now();
      // Run the rest of the request inside the trace context so the
      // wrapped fetch picks up the id.
      wireContext.run({ traceId: req.wireTraceId }, () => done());
      return;
    }
    done();
  });

  app.addHook('preSerialization', (req, _reply, payload, done) => {
    // Stash the soon-to-be-serialized payload on the request so the
    // onSend hook can render it. preSerialization fires for JSON
    // payloads only; raw streams skip it and onSend handles them.
    (req as unknown as { wirePayload?: unknown }).wirePayload = payload;
    done(null, payload);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (!wire.enabled()) return payload;
    if (!req.url.startsWith('/api/')) return payload;
    const traceId = req.wireTraceId ?? newTraceId();
    const start = req.wireStart ?? Date.now();
    const max = wire.maxBodyChars();
    const redact = opts.redactAuthHeaders();

    const reqBlocked = REQ_BODY_BLOCKLIST.some((re) => re.test(req.url.split('?')[0]!));

    let reqBody: string | undefined;
    if (reqBlocked) {
      reqBody = '<redacted: contains credentials>';
    } else if (req.body !== undefined && req.body !== null) {
      reqBody = describeReqBody(req.body, max);
    }

    let resBody: string | undefined;
    const stashed = (req as unknown as { wirePayload?: unknown }).wirePayload;
    if (typeof payload === 'string') {
      resBody = truncate(payload, max);
    } else if (stashed !== undefined) {
      // JSON payload — preSerialization captured the object, onSend
      // sees the serialized string. Render the stashed object so we
      // see the structure operators see in the response.
      resBody = truncate(safeStringify(stashed), max);
    } else if (typeof payload === 'object' && payload !== null) {
      resBody = `<stream or buffer>`;
    }

    wire.log({
      traceId,
      direction: 'inbound',
      ts: start,
      method: req.method,
      url: req.url,
      fromIp: req.ip,
      reqHeaders: redactHeaders(req.headers as Record<string, string>, redact),
      ...(reqBody !== undefined ? { reqBody } : {}),
      status: reply.statusCode,
      resHeaders: redactHeaders(reply.getHeaders() as Record<string, string>, redact),
      ...(resBody !== undefined ? { resBody } : {}),
      durationMs: Date.now() - start,
    });
    return payload;
  });

  // 4xx/5xx with thrown errors still hit onSend, so the path above
  // is enough — no separate onError hook needed for logging.
  void onErrorPlaceholder(app);
}

function onErrorPlaceholder(_app: FastifyInstance): void {
  // intentionally empty — keeps an explicit reference to the
  // request type so this file imports cleanly even when no error
  // hook is needed.
  void (null as unknown as FastifyRequest);
  void (null as unknown as FastifyReply);
}

function describeReqBody(body: unknown, max: number): string {
  if (typeof body === 'string') return truncate(body, max) ?? '';
  if (typeof body === 'object') return truncate(safeStringify(body), max) ?? '';
  return String(body);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '<unstringifiable>';
  }
}
