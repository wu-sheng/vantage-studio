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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { staticConfig } from '../src/config/loader.js';
import { createMemoryAuditLogger, type AuditLogger, type AuditEvent } from '../src/audit/logger.js';
import { buildServer } from '../src/server.js';
import { makeConfig } from './helpers.js';

interface Ctx {
  app: FastifyInstance;
  audit: AuditLogger & { events: AuditEvent[] };
}

async function makeApp(opts: { verifyResult: boolean }): Promise<Ctx> {
  const cfg = makeConfig({
    users: [{ username: 'alice', passwordHash: '$argon2id$pretend', roles: ['admin'] }],
    rbac: { enabled: true, roles: { admin: { verbs: ['*'] } } },
  });
  const config = staticConfig(cfg);
  const audit = createMemoryAuditLogger();
  const built = await buildServer({
    config,
    audit,
    loggerOptions: false,
    verifyDeps: { verify: async () => opts.verifyResult },
  });
  return { app: built.app, audit };
}

describe('auth routes', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await makeApp({ verifyResult: true });
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('login → /me → logout flow', async () => {
    const loginRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pw' },
    });
    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.username).toBe('alice');
    expect(body.roles).toEqual(['admin']);
    expect(body.verbs).toEqual(['*']);

    const setCookie = loginRes.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie as string);
    expect(cookieStr).toContain('sid=');
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(cookieStr.toLowerCase()).toContain('samesite=strict');

    const sidMatch = /sid=([^;]+)/.exec(cookieStr);
    expect(sidMatch).toBeTruthy();
    const sid = sidMatch![1]!;

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `sid=${sid}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().username).toBe('alice');

    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `sid=${sid}` },
    });
    expect(logoutRes.statusCode).toBe(204);

    const meAfter = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `sid=${sid}` },
    });
    expect(meAfter.statusCode).toBe(401);

    // Audit trail covers all three actor-initiated events.
    const actions = ctx.audit.events.map((e) => e.action);
    expect(actions).toEqual(['login', 'logout']);
    expect(ctx.audit.events[0]!.outcome).toBe('ok');
  });

  it('rejects bad password with 401 and audits unknown_user/bad_password', async () => {
    const failCtx = await makeApp({ verifyResult: false });
    try {
      const r1 = await failCtx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'wrong' },
      });
      expect(r1.statusCode).toBe(401);
      expect(failCtx.audit.events[0]!.outcome).toBe('bad_password');

      const r2 = await failCtx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'no-such', password: 'x' },
      });
      expect(r2.statusCode).toBe(401);
      expect(failCtx.audit.events[1]!.outcome).toBe('unknown_user');
    } finally {
      await failCtx.app.close();
    }
  });

  it('400 on a malformed login body', async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { not: 'right' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('401 on /me without a cookie', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(r.statusCode).toBe(401);
  });

  it('401 on /me with a stale sid', async () => {
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'sid=does-not-exist' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('healthz + readyz are public', async () => {
    const h = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    const r = await ctx.app.inject({ method: 'GET', url: '/readyz' });
    expect(h.statusCode).toBe(200);
    expect(r.statusCode).toBe(200);
  });
});
