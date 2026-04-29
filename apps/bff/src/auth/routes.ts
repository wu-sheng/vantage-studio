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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ConfigHandle } from '../config/loader.js';
import type { InMemorySessionStore } from './sessions.js';
import type { AuditLogger } from '../audit/logger.js';
import { verifyLocalLogin, type VerifyDeps } from './local.js';
import { resolveVerbs } from '../rbac/policy.js';
import { requireAuth } from './middleware.js';

export interface AuthRouteDeps {
  config: ConfigHandle;
  sessions: InMemorySessionStore;
  audit: AuditLogger;
  /** Test seam — overrides argon2.verify. */
  verifyDeps?: VerifyDeps;
}

const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

interface MeResponse {
  username: string;
  roles: readonly string[];
  verbs: readonly string[];
  expiresAt: number;
}

/** Register `POST /api/auth/login`, `POST /api/auth/logout`,
 *  `GET /api/auth/me` on the given Fastify instance. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.post('/api/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', detail: parsed.error.issues });
    }
    const { username, password } = parsed.data;
    const cfg = deps.config.current();

    const result = await verifyLocalLogin(cfg, username, password, deps.verifyDeps);

    if (!result.ok) {
      deps.audit.log({
        action: 'login',
        actor: null,
        outcome: result.reason,
        details: { username },
        fromIp: req.ip,
      });
      return reply.code(401).send({ error: 'unauthenticated' });
    }

    const ttlMs = cfg.session.ttlMinutes * 60_000;
    const session = deps.sessions.create(result.user.username, result.user.roles, ttlMs);

    reply.setCookie(cfg.session.cookieName, session.sid, {
      httpOnly: true,
      sameSite: 'strict',
      secure: cfg.session.cookieSecure,
      path: '/',
      expires: new Date(session.expiresAt),
    });

    deps.audit.log({
      action: 'login',
      actor: session.username,
      outcome: 'ok',
      details: { ttlMinutes: cfg.session.ttlMinutes },
      fromIp: req.ip,
      sessionId: session.sid,
    });

    const me: MeResponse = {
      username: session.username,
      roles: session.roles,
      verbs: resolveVerbs(cfg, session.roles),
      expiresAt: session.expiresAt,
    };
    return reply.code(200).send(me);
  });

  app.post(
    '/api/auth/logout',
    { preHandler: requireAuth(deps) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const cfg = deps.config.current();
      const sid = req.cookies?.[cfg.session.cookieName];
      const session = req.session;
      if (sid) deps.sessions.delete(sid);

      reply.clearCookie(cfg.session.cookieName, { path: '/' });

      deps.audit.log({
        action: 'logout',
        actor: session?.username ?? null,
        outcome: 'ok',
        fromIp: req.ip,
        sessionId: sid,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/auth/me',
    { preHandler: requireAuth(deps) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const cfg = deps.config.current();
      const session = req.session!;
      const me: MeResponse = {
        username: session.username,
        roles: session.roles,
        verbs: resolveVerbs(cfg, session.roles),
        expiresAt: session.expiresAt,
      };
      return reply.code(200).send(me);
    },
  );
}
