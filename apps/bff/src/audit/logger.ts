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
 * Audit logger — one structured JSONL line per actor-initiated event.
 * Goes to a separate destination from the app log so operators can
 * tail it without the noise of HTTP traces.
 *
 * Daily rotation is left to external infra (logrotate, k8s log shipper)
 * — Studio doesn't ship a built-in rotator in v1.
 */

import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { pino, type Logger } from 'pino';

export interface AuditEvent {
  /** What happened — login, logout, addOrUpdate, inactivate, … */
  action: string;
  /** The verb that was checked, if RBAC was consulted. */
  verb?: string;
  /** Who did it. `null` for anonymous events (e.g. failed login). */
  actor: string | null;
  /** Outcome — `ok` / `denied` / specific applyStatus / etc. */
  outcome: string;
  /** Free-form details: catalog/name, applyStatus, error message, … */
  details?: Record<string, unknown>;
  /** Caller IP when known. */
  fromIp?: string;
  /** Session id when one was attached. */
  sessionId?: string;
}

export interface AuditLogger {
  log(event: AuditEvent): void;
  /** Flush + close. Important on process exit. */
  close(): Promise<void>;
}

export interface CreateAuditLoggerOptions {
  /** Output file path (JSONL). Parent dirs auto-created. */
  file: string;
}

export async function createAuditLogger(opts: CreateAuditLoggerOptions): Promise<AuditLogger> {
  await mkdir(dirname(opts.file), { recursive: true });
  const dest = createWriteStream(opts.file, { flags: 'a' });
  const log: Logger = pino(
    {
      base: null, // drop pid + hostname; we want minimal columns
      timestamp: () => `,"ts":${Date.now()}`,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    dest,
  );

  return {
    log(event) {
      log.info(event);
    },
    async close() {
      await new Promise<void>((resolve) => {
        dest.end(() => resolve());
      });
    },
  };
}

/** A test/dev logger that captures events in memory. */
export function createMemoryAuditLogger(): AuditLogger & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    log(event) {
      events.push(event);
    },
    async close() {},
  };
}
