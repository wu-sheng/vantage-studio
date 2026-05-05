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

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FetchLike } from '@vantage-studio/api-client';
import { staticConfig } from '../src/config/loader.js';
import { createMemoryAuditLogger, type AuditEvent, type AuditLogger } from '../src/audit/logger.js';
import { buildServer } from '../src/server.js';
import { makeConfig } from './helpers.js';

interface Ctx {
  app: FastifyInstance;
  audit: AuditLogger & { events: AuditEvent[] };
  oapCalls: { url: string; init: RequestInit }[];
  sid: string;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface DebugStub {
  start?: (init: RequestInit, url: string) => Response;
  get?: (url: string) => Response;
  stop?: (url: string) => Response;
  list?: () => Response;
  /** Per-node `/dsl-debugging/status`, keyed by host substring. */
  perNodeStatus?: Record<string, () => Response>;
  status?: () => Response;
}

function makeFetch(stub: DebugStub): {
  fetch: FetchLike;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = input.toString();
    const r: RequestInit = init ?? {};
    calls.push({ url, init: r });

    if (url.includes('/dsl-debugging/status')) {
      if (stub.perNodeStatus) {
        for (const [host, gen] of Object.entries(stub.perNodeStatus)) {
          if (url.includes(host)) return gen();
        }
      }
      return stub.status?.() ?? new Response('no status stub', { status: 500 });
    }
    if (url.match(/\/dsl-debugging\/session\/[^/]+\/stop$/))
      return stub.stop?.(url) ?? new Response('no stop stub', { status: 500 });
    if (url.match(/\/dsl-debugging\/session\/[^/?]+(\?|$)/) && r.method === 'GET')
      return stub.get?.(url) ?? new Response('no get stub', { status: 500 });
    if (url.includes('/dsl-debugging/session') && r.method === 'POST')
      return stub.start?.(r, url) ?? new Response('no start stub', { status: 500 });
    if (url.includes('/dsl-debugging/sessions'))
      return stub.list?.() ?? new Response('no list stub', { status: 500 });
    return new Response(`unmocked: ${url}`, { status: 500 });
  };
  return { fetch: impl, calls };
}

async function makeApp(stub: DebugStub, opts: { rbac?: boolean } = {}): Promise<Ctx> {
  const cfg = makeConfig({
    users: [{ username: 'alice', passwordHash: '$argon2id$pretend', roles: ['admin'] }],
    rbac: opts.rbac
      ? {
          enabled: true,
          roles: {
            admin: { verbs: ['*'] },
          },
        }
      : undefined,
  });
  cfg.oap.adminUrls = ['http://oap-1:17128', 'http://oap-2:17128'];

  const config = staticConfig(cfg);
  const audit = createMemoryAuditLogger();
  const { fetch, calls } = makeFetch(stub);
  const built = await buildServer({
    config,
    audit,
    loggerOptions: false,
    verifyDeps: { verify: async () => true },
    oapFetch: fetch,
  });

  const login = await built.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'pw' },
  });
  const setCookie = login.headers['set-cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie as string);
  const sid = /sid=([^;]+)/.exec(cookieStr)![1]!;

  return { app: built.app, audit, oapCalls: calls, sid };
}

const sampleStartResponse = {
  sessionId: 'd-abc',
  clientId: 'tab-1',
  ruleKey: { catalog: 'lal', name: 'default.yaml', ruleName: 'default' },
  createdAt: 1700000000000,
  retentionDeadline: 1700000300000,
  peers: [{ peer: 'oap-2:11800', nodeId: 'oap-02', ack: 'INSTALLED' }],
  priorCleanup: [],
};

describe('debug-routes — POST /api/debug/session', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('translates SPA JSON body to upstream query params', async () => {
    ctx = await makeApp({
      start: (_init, url) => {
        // Verify the upstream call is query-param shaped.
        expect(url).toContain('catalog=lal');
        expect(url).toContain('name=default.yaml');
        expect(url).toContain('ruleName=default');
        expect(url).toContain('clientId=tab-1');
        return jsonResponse(sampleStartResponse);
      },
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: {
        clientId: 'tab-1',
        catalog: 'lal',
        name: 'default.yaml',
        ruleName: 'default',
        recordCap: 50,
        retentionMillis: 60_000,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().sessionId).toBe('d-abc');
    const startEvents = ctx.audit.events.filter((e) => e.action === 'debug.start');
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]!.outcome).toBe('ok');
    expect(startEvents[0]!.details).toMatchObject({
      sessionId: 'd-abc',
      clientId: 'tab-1',
      catalog: 'lal',
      name: 'default.yaml',
      ruleName: 'default',
      recordCap: 50,
      retentionMillis: 60_000,
      priorCleanupCount: 0,
    });
  });

  it('forwards an OAL session start where name=ruleName=source class', async () => {
    ctx = await makeApp({
      start: () =>
        jsonResponse({
          ...sampleStartResponse,
          ruleKey: { catalog: 'oal', name: 'Endpoint', ruleName: 'Endpoint' },
        }),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: { clientId: 'tab-1', catalog: 'oal', name: 'Endpoint', ruleName: 'Endpoint' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('rejects missing ruleName', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: { clientId: 'tab-1', catalog: 'oal', name: 'Endpoint' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('missing_ruleName');
  });

  it('rejects an invalid debug catalog', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: { clientId: 'tab-1', catalog: 'bogus', name: 'x', ruleName: 'x' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_catalog');
  });

  it('rejects negative recordCap', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: {
        clientId: 'tab-1',
        catalog: 'lal',
        name: 'default.yaml',
        ruleName: 'default',
        recordCap: -1,
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_recordCap');
  });

  it('returns 401 without a session', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      payload: { clientId: 'x', catalog: 'lal', name: 'default.yaml', ruleName: 'default' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('records OAP errors in the audit trail with the error code', async () => {
    ctx = await makeApp({
      start: () =>
        new Response(
          JSON.stringify({
            status: 'error',
            code: 'rule_not_found',
            message: 'no holder',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session',
      headers: { cookie: `sid=${ctx.sid}` },
      payload: {
        clientId: 'tab-1',
        catalog: 'lal',
        name: 'default.yaml',
        ruleName: 'default',
      },
    });
    expect(r.statusCode).toBe(404);
    const evt = ctx.audit.events.find((e) => e.action === 'debug.start');
    expect(evt!.outcome).toBe('rule_not_found');
  });
});

describe('debug-routes — GET /api/debug/session/:id', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns the session payload on 200', async () => {
    ctx = await makeApp({
      get: () =>
        jsonResponse({
          sessionId: 'd-1',
          nodes: [
            {
              nodeId: 'oap-01',
              status: 'ok',
              captured: false,
              totalBytes: 0,
              records: [],
            },
          ],
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/debug/session/d-1',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().nodes[0].status).toBe('ok');
  });

  it('returns 404 when OAP says not found', async () => {
    ctx = await makeApp({ get: () => new Response('expired', { status: 404 }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/debug/session/d-gone',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('debug-routes — POST /api/debug/session/:id/stop', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns the stop response and audits it', async () => {
    ctx = await makeApp({
      stop: () =>
        jsonResponse({
          sessionId: 'd-1',
          localStopped: true,
          peers: [],
        }),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/debug/session/d-1/stop',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().localStopped).toBe(true);
    const evt = ctx.audit.events.find((e) => e.action === 'debug.stop');
    expect(evt!.details?.sessionId).toBe('d-1');
    expect(evt!.outcome).toBe('ok');
  });
});

describe('debug-routes — GET /api/debug/sessions', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns the JSON object envelope', async () => {
    ctx = await makeApp({
      list: () =>
        jsonResponse({
          sessions: [
            {
              sessionId: 'd-1',
              clientId: 'c-1',
              ruleKey: { catalog: 'lal', name: 'default.yaml', ruleName: 'default' },
              createdAt: 1,
              retentionDeadline: 2,
              captured: false,
              totalBytes: 0,
            },
          ],
          count: 1,
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/debug/sessions',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.count).toBe(1);
    expect(body.sessions[0].sessionId).toBe('d-1');
  });
});

describe('debug-routes — GET /api/debug/status (cluster fan-out)', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('aggregates per-node 5-field status', async () => {
    ctx = await makeApp({
      perNodeStatus: {
        'oap-1': () =>
          jsonResponse({
            module: 'dsl-debugging',
            phase: 'phase-4',
            nodeId: 'oap-01',
            injectionEnabled: true,
            activeSessions: 3,
          }),
        'oap-2': () =>
          jsonResponse({
            module: 'dsl-debugging',
            phase: 'phase-4',
            nodeId: 'oap-02',
            injectionEnabled: false,
            activeSessions: 0,
          }),
      },
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/debug/status',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0].ok).toBe(true);
    expect(body.nodes[0].status.activeSessions).toBe(3);
    expect(body.nodes[1].status.injectionEnabled).toBe(false);
  });

  it('reports per-node errors as ok=false', async () => {
    ctx = await makeApp({
      perNodeStatus: {
        'oap-1': () => new Response('boom', { status: 500 }),
        'oap-2': () =>
          jsonResponse({
            module: 'dsl-debugging',
            phase: 'phase-4',
            nodeId: 'oap-02',
            injectionEnabled: true,
            activeSessions: 0,
          }),
      },
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/debug/status',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.nodes[0].ok).toBe(false);
    expect(body.nodes[1].ok).toBe(true);
  });
});
