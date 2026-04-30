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
 * Build a Fastify instance with the v1 BFF surface wired in. Keeps
 * `index.ts` tiny and lets tests construct the server with synthetic
 * dependencies (a static config, an in-memory audit logger, etc.).
 */

import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import type { FetchLike } from '@vantage-studio/api-client';
import type { ConfigHandle } from './config/loader.js';
import { InMemorySessionStore } from './auth/sessions.js';
import type { AuditLogger } from './audit/logger.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { VerifyDeps } from './auth/local.js';
import { registerOapRoutes } from './oap/routes.js';

export interface BuildServerOptions {
  config: ConfigHandle;
  sessions?: InMemorySessionStore;
  audit: AuditLogger;
  /** Forwarded to the auth routes. Test seam for argon2. */
  verifyDeps?: VerifyDeps;
  /** Pino options forwarded to Fastify (e.g. `{ level: 'silent' }`
   *  during tests). */
  loggerOptions?: { level?: string } | boolean;
  /** Test seam — replaces global fetch in every OAP call. */
  oapFetch?: FetchLike;
  /** Absolute path to the built SPA's `dist/` directory. When set
   *  (production), the BFF serves it under `/` with a SPA-fallback
   *  to `index.html` for unknown non-`/api/*` paths. Unset (dev),
   *  Vite serves the SPA on its own port + proxies `/api/*` here. */
  uiDir?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  sessions: InMemorySessionStore;
}

/** Construct the Fastify app with auth + cookie support and any
 *  Phase-2 routes. Phase 3 will add `registerOapRoutes(app, ...)` here. */
export async function buildServer(opts: BuildServerOptions): Promise<BuiltServer> {
  const sessions = opts.sessions ?? new InMemorySessionStore();
  const cfg = opts.config.current();

  const app = Fastify({
    logger: opts.loggerOptions ?? { level: 'info' },
    trustProxy: cfg.server.trustProxy,
    bodyLimit: 2 * 1024 * 1024, // 2 MB — rule YAML is small; reject pathological bodies up front.
  });

  await app.register(cookie);

  // The runtime-rule write path posts raw YAML; register a passthrough
  // parser for text/plain so Fastify hands the body to the handler as
  // a string instead of trying to JSON-parse it.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  registerAuthRoutes(app, {
    config: opts.config,
    sessions,
    audit: opts.audit,
    verifyDeps: opts.verifyDeps,
  });

  registerOapRoutes(app, {
    config: opts.config,
    sessions,
    audit: opts.audit,
    ...(opts.oapFetch !== undefined ? { fetch: opts.oapFetch } : {}),
  });

  app.get('/healthz', async (_req, reply) => reply.code(200).send({ ok: true }));
  app.get('/readyz', async (_req, reply) => reply.code(200).send({ ok: true }));

  if (opts.uiDir && existsSync(opts.uiDir)) {
    await app.register(staticPlugin, {
      root: opts.uiDir,
      prefix: '/',
      // Disable wildcard so /api/* and the health probes match first.
      wildcard: false,
    });
    // SPA fallback: any non-/api/* path that didn't match a static
    // file gets index.html so vue-router's history mode works on
    // page reload.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url;
      if (url.startsWith('/api/') || url === '/healthz' || url === '/readyz') {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, sessions };
}
