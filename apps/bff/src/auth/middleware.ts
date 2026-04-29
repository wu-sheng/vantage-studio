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
 * Per-request auth + RBAC pre-handlers. Pluggable into any Fastify
 * route via `{ preHandler: [requireAuth(deps), requireVerb(deps, 'rule:read')] }`.
 *
 * The two-step shape (require-auth, then require-verb) keeps the
 * verb-name visible at the route declaration — easier to audit which
 * verb gates which route.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigHandle } from '../config/loader.js';
import type { Session, InMemorySessionStore } from './sessions.js';
import { sessionHasVerb } from '../rbac/policy.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth` after a valid session is found. */
    session?: Session;
  }
}

export interface AuthDeps {
  config: ConfigHandle;
  sessions: InMemorySessionStore;
}

/** Factory: returns a Fastify pre-handler that loads the session from
 *  the request cookie and attaches it to `req.session`. Returns 401
 *  with `{error: "unauthenticated"}` when no valid session is found. */
export function requireAuth(deps: AuthDeps) {
  return async function authPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const cookieName = deps.config.current().session.cookieName;
    const sid = req.cookies?.[cookieName];
    if (!sid) {
      return void reply.code(401).send({ error: 'unauthenticated' });
    }
    const session = deps.sessions.get(sid);
    if (!session) {
      return void reply.code(401).send({ error: 'unauthenticated' });
    }
    req.session = session;
  };
}

/** Factory: returns a Fastify pre-handler that asserts the session has
 *  the given verb. Must run AFTER `requireAuth`. Returns 403 with
 *  `{error: "permission_denied", verb}` on failure. When RBAC is
 *  disabled in config, every authenticated user passes. */
export function requireVerb(deps: AuthDeps, verb: string) {
  return async function verbPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = req.session;
    if (!session) {
      // Defensive — the route forgot to chain requireAuth first.
      return void reply.code(401).send({ error: 'unauthenticated' });
    }
    const cfg = deps.config.current();
    if (!sessionHasVerb(cfg, session.roles, verb)) {
      return void reply.code(403).send({ error: 'permission_denied', verb });
    }
  };
}
