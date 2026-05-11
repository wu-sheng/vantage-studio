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
import { createMemoryAuditLogger } from '../src/audit/logger.js';
import { buildServer } from '../src/server.js';
import { makeConfig } from './helpers.js';

interface Ctx {
  app: FastifyInstance;
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

interface InspectStub {
  metrics?: (url: string) => Response;
  entities?: (url: string) => Response;
  /** /runtime/oal/files — bare name listing. */
  oalFiles?: () => Response;
  /** /runtime/oal/files/{name} — raw .oal text. */
  oalFile?: (name: string) => Response;
  /** /runtime/rule/list — MAL rule rows with contentHash. */
  ruleList?: () => Response;
  /** /runtime/rule?catalog=…&name=… — single rule YAML. */
  ruleGet?: (catalog: string, name: string) => Response;
  /** /runtime/rule/bundled?catalog=…&withContent=… */
  ruleBundled?: (catalog: string) => Response;
  /** /debugging/config/dump — flat HashMap<string,string>. */
  configDump?: () => Response;
  /** Overrides studio config (e.g. mqe override). */
  mqe?: { host?: string; port?: number };
  /** GraphQL `execExpression` endpoint — receives the POSTed body. */
  graphql?: (body: unknown) => Response;
  /** GraphQL `getTimeInfo` endpoint — separate from MQE exec. */
  serverTimeGraphql?: (body: unknown) => Response;
}

function makeFetch(stub: InspectStub): {
  fetch: FetchLike;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = input.toString();
    calls.push({ url, init: init ?? {} });
    if (url.includes('/inspect/metrics'))
      return stub.metrics?.(url) ?? new Response('no metrics stub', { status: 500 });
    if (url.includes('/inspect/entities'))
      return stub.entities?.(url) ?? new Response('no entities stub', { status: 500 });
    // Match `/runtime/oal/files/{name}` BEFORE the bare `/runtime/oal/files`.
    const oalFileMatch = url.match(/\/runtime\/oal\/files\/([^?]+)/);
    if (oalFileMatch) {
      const name = decodeURIComponent(oalFileMatch[1]!);
      return stub.oalFile?.(name) ?? new Response(`no oalFile stub for ${name}`, { status: 500 });
    }
    if (url.includes('/runtime/oal/files'))
      return stub.oalFiles?.() ?? new Response('no oalFiles stub', { status: 500 });
    if (url.includes('/runtime/rule/list'))
      return stub.ruleList?.() ?? new Response('no ruleList stub', { status: 500 });
    if (url.includes('/runtime/rule/bundled')) {
      const u = new URL(url);
      const cat = u.searchParams.get('catalog') ?? '';
      return stub.ruleBundled?.(cat) ?? jsonResponse([]);
    }
    if (url.match(/\/runtime\/rule\?/)) {
      const u = new URL(url);
      const catalog = u.searchParams.get('catalog') ?? '';
      const name = u.searchParams.get('name') ?? '';
      return stub.ruleGet?.(catalog, name) ?? new Response('no ruleGet stub', { status: 500 });
    }
    if (url.includes('/debugging/config/dump'))
      return stub.configDump?.() ?? new Response('no configDump stub', { status: 500 });
    if (url.endsWith('/graphql')) {
      let parsed: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          parsed = JSON.parse(init.body);
        } catch {
          /* leave null */
        }
      }
      /* getTimeInfo uses its own stub if provided, so MQE exec and
       * server-time tests can coexist. */
      const body = parsed as { query?: string } | null;
      if (body?.query && body.query.includes('getTimeInfo')) {
        return (
          stub.serverTimeGraphql?.(body) ?? new Response('no serverTime stub', { status: 500 })
        );
      }
      return stub.graphql?.(parsed) ?? new Response('no graphql stub', { status: 500 });
    }
    return new Response(`unmocked: ${url}`, { status: 500 });
  };
  return { fetch: impl, calls };
}

async function makeApp(stub: InspectStub, opts: { rbac?: boolean } = {}): Promise<Ctx> {
  const cfg = makeConfig({
    users: [{ username: 'alice', passwordHash: '$argon2id$pretend', roles: ['admin'] }],
    rbac: opts.rbac
      ? {
          enabled: true,
          roles: {
            admin: { verbs: ['*'] },
            reader: { verbs: ['inspect:read'] },
            noinspect: { verbs: ['rule:read'] },
          },
        }
      : undefined,
  });
  if (stub.mqe) cfg.oap.mqe = stub.mqe;
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

  return { app: built.app, oapCalls: calls, sid };
}

describe('GET /api/inspect/metrics', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('proxies the catalog with no filters', async () => {
    ctx = await makeApp({
      metrics: () =>
        jsonResponse({
          metrics: [
            {
              name: 'service_cpm',
              type: 'REGULAR_VALUE',
              catalog: 'SERVICE',
              scopeId: 1,
              scope: 'Service',
              valueColumnName: 'value',
              downsamplings: ['MINUTE', 'HOUR', 'DAY'],
            },
          ],
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/metrics',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { metrics: { name: string }[] };
    expect(body.metrics[0]!.name).toBe('service_cpm');
    expect(ctx.oapCalls[0]!.url).toBe('http://oap-1:17128/inspect/metrics');
  });

  it('passes regex, repeatable type, repeatable catalog, mqeQueryable', async () => {
    ctx = await makeApp({ metrics: () => jsonResponse({ metrics: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url:
        '/api/inspect/metrics?regex=service_.*' +
        '&type=REGULAR_VALUE&type=LABELED_VALUE' +
        '&catalog=SERVICE&catalog=ENDPOINT' +
        '&mqeQueryable=true',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const oap = new URL(ctx.oapCalls[0]!.url);
    expect(oap.pathname).toBe('/inspect/metrics');
    expect(oap.searchParams.get('regex')).toBe('service_.*');
    expect(oap.searchParams.getAll('type')).toEqual(['REGULAR_VALUE', 'LABELED_VALUE']);
    expect(oap.searchParams.getAll('catalog')).toEqual(['SERVICE', 'ENDPOINT']);
    expect(oap.searchParams.get('mqeQueryable')).toBe('true');
  });

  it('rejects an unknown `type` value with 400 invalid_type', async () => {
    ctx = await makeApp({ metrics: () => jsonResponse({ metrics: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/metrics?type=BANANA',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_type', value: 'BANANA' });
    expect(ctx.oapCalls).toHaveLength(0);
  });

  it('promotes OAP 404 to inspect_not_enabled', async () => {
    ctx = await makeApp({
      metrics: () => new Response('no handler', { status: 404 }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/metrics',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: 'inspect_not_enabled' });
  });

  it('passes through OAP 500 with original body', async () => {
    ctx = await makeApp({
      metrics: () =>
        new Response(JSON.stringify({ error: 'storage exploded' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/metrics',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'storage exploded' });
  });

  it('returns 401 without a session cookie', async () => {
    ctx = await makeApp({ metrics: () => jsonResponse({ metrics: [] }) });
    const r = await ctx.app.inject({ method: 'GET', url: '/api/inspect/metrics' });
    expect(r.statusCode).toBe(401);
  });

  it('with RBAC on, a session without inspect:read gets 403', async () => {
    // Login with a user whose role has rule:read but not inspect:read.
    const cfg = makeConfig({
      users: [{ username: 'bob', passwordHash: '$argon2id$pretend', roles: ['noinspect'] }],
      rbac: {
        enabled: true,
        roles: {
          admin: { verbs: ['*'] },
          noinspect: { verbs: ['rule:read'] },
        },
      },
    });
    const config = staticConfig(cfg);
    const audit = createMemoryAuditLogger();
    const { fetch } = makeFetch({ metrics: () => jsonResponse({ metrics: [] }) });
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
      payload: { username: 'bob', password: 'pw' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie as string);
    const sid = /sid=([^;]+)/.exec(cookieStr)![1]!;
    const r = await built.app.inject({
      method: 'GET',
      url: '/api/inspect/metrics',
      headers: { cookie: `sid=${sid}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'permission_denied', verb: 'inspect:read' });
    await built.app.close();
  });
});

describe('GET /api/inspect/entities', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('proxies metric / start / end / step / limit and returns the rows', async () => {
    ctx = await makeApp({
      entities: () =>
        jsonResponse({
          metric: 'service_cpm',
          scope: 'Service',
          step: 'MINUTE',
          start: '2026-05-10 1220',
          end: '2026-05-10 1240',
          rows: [
            {
              entityId: 'cGF5bWVudA==.1',
              decoded: { serviceName: 'payment', isReal: true },
              layer: 'GENERAL',
              mqeEntity: { scope: 'Service', serviceName: 'payment', normal: true },
            },
          ],
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url:
        '/api/inspect/entities?metric=service_cpm' +
        '&start=2026-05-10%201220&end=2026-05-10%201240&step=MINUTE&limit=10',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { rows: { entityId: string }[] };
    expect(body.rows[0]!.entityId).toBe('cGF5bWVudA==.1');
    const oap = new URL(ctx.oapCalls[0]!.url);
    expect(oap.searchParams.get('step')).toBe('MINUTE');
    expect(oap.searchParams.get('start')).toBe('2026-05-10 1220');
    expect(oap.searchParams.get('limit')).toBe('10');
  });

  it('400 missing_metric when metric is absent', async () => {
    ctx = await makeApp({ entities: () => jsonResponse({ rows: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/entities?start=2026-05-10&end=2026-05-10&step=DAY',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'missing_metric' });
  });

  it('400 invalid_step for a bad step value', async () => {
    ctx = await makeApp({ entities: () => jsonResponse({ rows: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/entities?metric=x&start=2026-05-10&end=2026-05-10&step=SECOND',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_step' });
  });

  it('400 invalid_start_format for a date that does not match the step', async () => {
    ctx = await makeApp({ entities: () => jsonResponse({ rows: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      // MINUTE step expects `yyyy-MM-dd HHmm` but we pass DAY-shape `yyyy-MM-dd`.
      url: '/api/inspect/entities?metric=x&start=2026-05-10&end=2026-05-10&step=MINUTE',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_start_format', step: 'MINUTE' });
    // Pre-validation short-circuits before we hit OAP.
    expect(ctx.oapCalls).toHaveLength(0);
  });

  it('400 invalid_limit when outside [1, 300]', async () => {
    ctx = await makeApp({ entities: () => jsonResponse({ rows: [] }) });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/entities?metric=x&start=2026-05-10&end=2026-05-10' + '&step=DAY&limit=500',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_limit', max: 300 });
  });

  it('passes through OAP 400 (e.g. unknown metric) verbatim', async () => {
    ctx = await makeApp({
      entities: () =>
        new Response(JSON.stringify({ error: 'unknown metric: foo' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/entities?metric=foo&start=2026-05-10&end=2026-05-10&step=DAY',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'unknown metric: foo' });
  });
});

describe('GET /api/inspect/catalog', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('merges /inspect/metrics with OAL + MAL attribution', async () => {
    ctx = await makeApp({
      metrics: () =>
        jsonResponse({
          metrics: [
            {
              name: 'service_cpm',
              type: 'REGULAR_VALUE',
              catalog: 'SERVICE',
              scopeId: 1,
              scope: 'Service',
              valueColumnName: 'value',
              downsamplings: ['MINUTE'],
            },
            {
              name: 'instance_jvm_memory_heap_used',
              type: 'REGULAR_VALUE',
              catalog: 'SERVICE_INSTANCE',
              scopeId: 2,
              scope: 'ServiceInstance',
              valueColumnName: 'value',
              downsamplings: ['MINUTE'],
            },
            {
              name: 'mystery_metric_no_source',
              type: 'REGULAR_VALUE',
              catalog: 'SERVICE',
              scopeId: 1,
              scope: 'Service',
              valueColumnName: 'value',
              downsamplings: ['MINUTE'],
            },
          ],
        }),
      oalFiles: () => jsonResponse({ files: ['core.oal'], count: 1 }),
      oalFile: (name) => {
        if (name === 'core.oal')
          return new Response('service_cpm = from(Service.*).cpm();\n', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          });
        return new Response('not found', { status: 404 });
      },
      ruleList: () =>
        jsonResponse({
          generatedAt: 1730000000000,
          loaderStats: { active: 1, pending: 0 },
          rules: [
            {
              catalog: 'otel-rules',
              name: 'jvm-memory',
              status: 'ACTIVE',
              localState: 'RUNNING',
              loaderGc: 'LIVE',
              loaderKind: 'RUNTIME',
              loaderName: 'runtime:otel-rules/jvm-memory@0510-1200',
              contentHash: 'abc',
              bundled: false,
              suspendOrigin: 'NONE',
              updateTime: 0,
              lastApplyError: '',
              pendingUnregister: false,
            },
          ],
        }),
      ruleGet: (catalog, name) => {
        if (catalog === 'otel-rules' && name === 'jvm-memory') {
          return new Response(
            'metricPrefix: instance_jvm_memory\nmetricsRules:\n  - name: heap_used\n    exp: jvm_memory_used_bytes\n',
            {
              status: 200,
              headers: {
                'Content-Type': 'application/x-yaml; charset=utf-8',
                etag: '"abc"',
                'x-sw-content-hash': 'abc',
                'x-sw-status': 'ACTIVE',
                'x-sw-source': 'runtime',
                'x-sw-update-time': '0',
              },
            },
          );
        }
        return new Response('not found', { status: 404 });
      },
    });

    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/catalog',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      metrics: { name: string; attribution: { source: string; file: string | null } }[];
      summary: Record<string, number>;
      attributionFingerprint: string;
    };
    const byName = Object.fromEntries(body.metrics.map((m) => [m.name, m.attribution]));
    expect(byName['service_cpm']).toEqual({ source: 'OAL', file: 'core.oal' });
    expect(byName['instance_jvm_memory_heap_used']).toEqual({
      source: 'MAL·OTEL',
      file: 'otel-rules/jvm-memory',
    });
    expect(byName['mystery_metric_no_source']).toEqual({ source: 'unknown', file: null });
    expect(body.summary['OAL']).toBe(1);
    expect(body.summary['MAL·OTEL']).toBe(1);
    expect(body.summary['unknown']).toBe(1);
    expect(body.attributionFingerprint).toContain('oal:core.oal');
    expect(body.attributionFingerprint).toContain('otel-rules/jvm-memory@abc');
  });

  it('refresh=true re-pulls the rules (cache busts)', async () => {
    let oalCalls = 0;
    const stub: InspectStub = {
      metrics: () => jsonResponse({ metrics: [] }),
      oalFiles: () => {
        oalCalls += 1;
        return jsonResponse({ files: ['core.oal'], count: 1 });
      },
      oalFile: () =>
        new Response('a = from(X.y).foo();', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      ruleList: () =>
        jsonResponse({
          generatedAt: 0,
          loaderStats: { active: 0, pending: 0 },
          rules: [],
        }),
    };
    ctx = await makeApp(stub);
    // First call — cold cache.
    await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/catalog',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    // Second call without refresh — fingerprint matches, only the
    // fingerprint endpoints get re-hit, the file content read stays cached.
    await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/catalog',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    const before = oalCalls;
    // Third call with refresh=true — full rebuild, listFiles is hit
    // again as part of the rebuild path on top of the fingerprint call.
    await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/catalog?refresh=true',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(oalCalls).toBeGreaterThan(before);
  });
});

describe('GET /api/inspect/mqe-target', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('prefers sharing-server REST when present', async () => {
    ctx = await makeApp({
      configDump: () =>
        jsonResponse({
          'core.default.restHost': '0.0.0.0',
          'core.default.restPort': '12800',
          'sharing-server.default.restHost': '0.0.0.0',
          'sharing-server.default.restPort': '11800',
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/mqe-target',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { baseUrl: string; via: string; configured: object };
    // sharing host was 0.0.0.0 → falls back to admin host `oap-1`.
    expect(body.baseUrl).toBe('http://oap-1:11800');
    expect(body.via).toContain('sharing-server.restPort');
    expect(body.via).toContain('admin URL host');
  });

  it('falls back to core REST when sharing-server is absent', async () => {
    ctx = await makeApp({
      configDump: () =>
        jsonResponse({
          'core.default.restHost': 'rest.cluster.local',
          'core.default.restPort': '12800',
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/mqe-target',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { baseUrl: string; via: string };
    expect(body.baseUrl).toBe('http://rest.cluster.local:12800');
    expect(body.via).toContain('core.restPort');
  });

  it('respects a full studio.yaml override without calling admin', async () => {
    ctx = await makeApp({
      mqe: { host: 'mqe.gateway.local', port: 9443 },
      // No configDump stub — must not be called when both fields are set.
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/mqe-target',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      baseUrl: string;
      via: string;
      configured: { host: string; port: number };
    };
    expect(body.baseUrl).toBe('http://mqe.gateway.local:9443');
    expect(body.via).toBe('studio.yaml override (host + port)');
    expect(body.configured).toEqual({ host: 'mqe.gateway.local', port: 9443 });
    // No outbound admin fetch for the full-override path.
    expect(ctx.oapCalls.filter((c) => c.url.includes('config/dump'))).toHaveLength(0);
  });

  it('stitches a host override on top of a discovered port', async () => {
    ctx = await makeApp({
      mqe: { host: 'rest.gateway.local' },
      configDump: () =>
        jsonResponse({
          'core.default.restHost': '0.0.0.0',
          'core.default.restPort': '12800',
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/mqe-target',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { baseUrl: string; via: string };
    expect(body.baseUrl).toBe('http://rest.gateway.local:12800');
    expect(body.via).toBe('host from studio.yaml, port from core.restPort');
  });

  it('502 when neither port appears in the dump', async () => {
    ctx = await makeApp({
      configDump: () =>
        jsonResponse({
          'storage.default.url': 'jdbc:h2',
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/mqe-target',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ error: 'mqe_target_unresolved' });
  });
});

describe('GET /api/preflight', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('marks every required module enabled when its prefix is in the dump', async () => {
    ctx = await makeApp({
      configDump: () =>
        jsonResponse({
          'admin-server.default.host': '0.0.0.0',
          'admin-server.default.port': '17128',
          'receiver-runtime-rule.default.foo': 'bar',
          'dsl-debugging.default.sampleCap': '100',
          'inspect.default.x': 'y',
          'core.default.restPort': '12800',
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/preflight',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      adminReachable: boolean;
      modules: { name: string; enabled: boolean }[];
    };
    expect(body.adminReachable).toBe(true);
    const m = Object.fromEntries(body.modules.map((x) => [x.name, x.enabled]));
    expect(m['admin-server']).toBe(true);
    expect(m['receiver-runtime-rule']).toBe(true);
    expect(m['dsl-debugging']).toBe(true);
    expect(m['inspect']).toBe(true);
  });

  it('marks the missing modules false (the OAP-was-not-fully-configured case)', async () => {
    ctx = await makeApp({
      configDump: () =>
        jsonResponse({
          'admin-server.default.host': '0.0.0.0',
          'inspect.default.x': 'y',
          // receiver-runtime-rule and dsl-debugging absent.
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/preflight',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { modules: { name: string; enabled: boolean; envVar: string }[] };
    const m = Object.fromEntries(body.modules.map((x) => [x.name, x]));
    expect(m['admin-server']!.enabled).toBe(true);
    expect(m['inspect']!.enabled).toBe(true);
    expect(m['receiver-runtime-rule']!.enabled).toBe(false);
    expect(m['receiver-runtime-rule']!.envVar).toBe('SW_RECEIVER_RUNTIME_RULE');
    expect(m['dsl-debugging']!.enabled).toBe(false);
  });

  it('reports adminReachable=false when the dump endpoint fails', async () => {
    ctx = await makeApp({
      configDump: () => new Response('boom', { status: 500 }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/preflight',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      adminReachable: boolean;
      adminError?: string;
      modules: { enabled: boolean }[];
    };
    expect(body.adminReachable).toBe(false);
    expect(body.adminError).toContain('500');
    /* All modules collapse to disabled when admin itself is down —
     * the operator's first move is "check OAP", not "set selectors". */
    for (const m of body.modules) expect(m.enabled).toBe(false);
  });
});

describe('POST /api/inspect/exec', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  function execBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      expression: 'service_cpm',
      entity: { scope: 'Service', serviceName: 'payment', normal: true },
      duration: { start: '2026-05-10 1220', end: '2026-05-10 1240', step: 'MINUTE' },
      ...overrides,
    };
  }

  it('fires the GraphQL mutation and returns the ExpressionResult', async () => {
    let graphqlCalls = 0;
    let receivedBody: unknown = null;
    ctx = await makeApp({
      mqe: { host: 'mqe.local', port: 12800 },
      graphql: (body) => {
        graphqlCalls += 1;
        receivedBody = body;
        return jsonResponse({
          data: {
            execExpression: {
              type: 'TIME_SERIES_VALUES',
              error: null,
              results: [
                {
                  metric: { labels: [] },
                  values: [{ id: '2026051012200000', value: '42', traceID: null, owner: null }],
                },
              ],
            },
          },
        });
      },
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/inspect/exec',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify(execBody()),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { type: string; results: { values: { value: string }[] }[] };
    expect(body.type).toBe('TIME_SERIES_VALUES');
    expect(body.results[0]!.values[0]!.value).toBe('42');
    expect(graphqlCalls).toBe(1);
    const sent = receivedBody as {
      query: string;
      variables: {
        expression: string;
        entity: { scope: string; serviceName: string };
        duration: { step: string };
      };
    };
    expect(sent.query).toContain('execExpression');
    expect(sent.query).toContain('query Exec');
    expect(sent.variables.expression).toBe('service_cpm');
    expect(sent.variables.entity.serviceName).toBe('payment');
    expect(sent.variables.duration.step).toBe('MINUTE');
  });

  it('400 on missing expression', async () => {
    ctx = await makeApp({ mqe: { host: 'x', port: 1 } });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/inspect/exec',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        entity: { scope: 'Service', serviceName: 'a' },
        duration: { start: '2026-05-10', end: '2026-05-10', step: 'DAY' },
      }),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'missing_expression' });
  });

  it('400 on bad start format for the step', async () => {
    ctx = await makeApp({ mqe: { host: 'x', port: 1 } });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/inspect/exec',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify(
        execBody({
          duration: { start: '2026-05-10', end: '2026-05-10 1240', step: 'MINUTE' },
        }),
      ),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_duration' });
  });

  it('502 mqe_error when GraphQL returns errors', async () => {
    ctx = await makeApp({
      mqe: { host: 'mqe.local', port: 12800 },
      graphql: () =>
        jsonResponse({
          data: null,
          errors: [{ message: 'metric not found: foo' }],
        }),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/inspect/exec',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'application/json' },
      payload: JSON.stringify(execBody()),
    });
    expect(r.statusCode).toBe(502);
    const body = r.json() as { error: string; graphqlErrors: { message: string }[] };
    expect(body.error).toBe('mqe_error');
    expect(body.graphqlErrors[0]!.message).toBe('metric not found: foo');
  });
});

describe('GET /api/inspect/server-time', () => {
  let ctx: Ctx;
  afterEach(async () => {
    await ctx.app.close();
  });

  it('returns offset in minutes converted from the getTimeInfo HHMM integer', async () => {
    ctx = await makeApp({
      mqe: { host: 'mqe.local', port: 12800 },
      serverTimeGraphql: () =>
        jsonResponse({
          data: { getTimeInfo: { timezone: 800, currentTimestamp: 1730000000000 } },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/server-time',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      offsetMinutes: 480,
      source: 'oap',
      currentTimestampMillis: 1730000000000,
    });
  });

  it('falls back to BFF local offset when getTimeInfo returns errors', async () => {
    ctx = await makeApp({
      mqe: { host: 'mqe.local', port: 12800 },
      serverTimeGraphql: () => jsonResponse({ data: null, errors: [{ message: 'unknown field' }] }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/inspect/server-time',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { source: string; error?: string; offsetMinutes: number };
    expect(body.source).toBe('fallback');
    expect(body.error).toContain('unknown field');
    expect(typeof body.offsetMinutes).toBe('number');
  });
});
