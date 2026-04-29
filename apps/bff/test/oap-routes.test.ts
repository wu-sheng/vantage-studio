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

interface OapStub {
  list?: () => Response;
  bundled?: () => Response;
  get?: (url: string, init: RequestInit) => Response;
  addOrUpdate?: (url: string, init: RequestInit) => Response;
  inactivate?: () => Response;
  delete?: (url: string) => Response;
  dump?: () => Response;
  /** Fan-out — keyed by host portion of admin URL. */
  perNodeList?: Record<string, () => Response>;
}

/** Build a FetchLike that routes by URL substring. */
function makeFetch(stub: OapStub): {
  fetch: FetchLike;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (input, init) => {
    const url = input.toString();
    const r: RequestInit = init ?? {};
    calls.push({ url, init: r });

    if (stub.perNodeList && url.includes('/runtime/rule/list')) {
      for (const [host, gen] of Object.entries(stub.perNodeList)) {
        if (url.includes(host)) return gen();
      }
    }
    if (url.includes('/runtime/rule/list'))
      return stub.list?.() ?? new Response('no list stub', { status: 500 });
    if (url.includes('/runtime/rule/bundled'))
      return stub.bundled?.() ?? new Response('no bundled stub', { status: 500 });
    if (url.includes('/runtime/rule/dump'))
      return stub.dump?.() ?? new Response('no dump stub', { status: 500 });
    if (url.includes('/runtime/rule/addOrUpdate'))
      return stub.addOrUpdate?.(url, r) ?? new Response('no addOrUpdate stub', { status: 500 });
    if (url.includes('/runtime/rule/inactivate'))
      return stub.inactivate?.() ?? new Response('no inactivate stub', { status: 500 });
    if (url.includes('/runtime/rule/delete'))
      return stub.delete?.(url) ?? new Response('no delete stub', { status: 500 });
    if (url.match(/\/runtime\/rule\?/))
      return stub.get?.(url, r) ?? new Response('no get stub', { status: 500 });
    return new Response(`unmocked: ${url}`, { status: 500 });
  };
  return { fetch: impl, calls };
}

async function makeApp(stub: OapStub, opts: { rbac?: boolean } = {}): Promise<Ctx> {
  const cfg = makeConfig({
    users: [{ username: 'alice', passwordHash: '$argon2id$pretend', roles: ['admin'] }],
    rbac: opts.rbac
      ? {
          enabled: true,
          roles: {
            admin: { verbs: ['*'] },
            reader: { verbs: ['rule:read', 'cluster:read'] },
          },
        }
      : undefined,
  });
  // Override adminUrls for fan-out tests where we want multiple nodes.
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

describe('OAP route — /api/catalog/list', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('proxies the envelope from OAP', async () => {
    ctx = await makeApp({
      list: () =>
        jsonResponse({
          generatedAt: 1730000000000,
          loaderStats: { active: 1, pending: 0 },
          rules: [],
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/list?catalog=otel-rules',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().rules).toEqual([]);
    expect(ctx.oapCalls[0]!.url).toContain(
      'http://oap-1:17128/runtime/rule/list?catalog=otel-rules',
    );
  });

  it('rejects an invalid catalog with 400', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/list?catalog=oal',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_catalog');
  });

  it('returns 401 without a session', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({ method: 'GET', url: '/api/catalog/list' });
    expect(r.statusCode).toBe(401);
  });
});

describe('OAP route — /api/rule (POST/GET) verb promotion', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET passes catalog/name/source through to OAP', async () => {
    ctx = await makeApp({
      get: () =>
        new Response('metricsRules:\n  - name: vm_cpu', {
          status: 200,
          headers: {
            'Content-Type': 'application/x-yaml',
            'X-Sw-Content-Hash': '7c3a',
            'X-Sw-Status': 'ACTIVE',
            'X-Sw-Source': 'runtime',
            'X-Sw-Update-Time': '1730',
            ETag: '"7c3a"',
          },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/rule?catalog=otel-rules&name=vm&source=runtime',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-sw-content-hash']).toBe('7c3a');
    expect(r.body).toContain('vm_cpu');
    expect(ctx.oapCalls[0]!.url).toContain('source=runtime');
  });

  it('GET surfaces 304 from OAP with ETag preserved', async () => {
    ctx = await makeApp({
      get: () =>
        new Response(null, {
          status: 304,
          headers: { ETag: '"7c3a"', 'X-Sw-Content-Hash': '7c3a', 'X-Sw-Status': 'ACTIVE' },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/rule?catalog=otel-rules&name=vm',
      headers: { cookie: `sid=${ctx.sid}`, 'if-none-match': '"7c3a"' },
    });
    expect(r.statusCode).toBe(304);
    expect(r.headers.etag).toBe('"7c3a"');
  });

  it('POST without flags requires rule:write only (passes for admin role)', async () => {
    ctx = await makeApp(
      {
        addOrUpdate: () =>
          jsonResponse({
            applyStatus: 'filter_only_applied',
            catalog: 'otel-rules',
            name: 'vm',
            message: '',
          }),
      },
      { rbac: true },
    );
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule?catalog=otel-rules&name=vm',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'text/plain' },
      payload: 'metricsRules:\n  - name: vm_cpu',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().applyStatus).toBe('filter_only_applied');
    expect(ctx.oapCalls[0]!.init.body).toContain('vm_cpu');
    // Audit recorded with the lower verb.
    expect(ctx.audit.events.find((e) => e.action === 'addOrUpdate')!.verb).toBe('rule:write');
  });

  it('POST with allowStorageChange promotes the verb to rule:write:structural', async () => {
    ctx = await makeApp(
      {
        addOrUpdate: () =>
          jsonResponse({
            applyStatus: 'structural_applied',
            catalog: 'otel-rules',
            name: 'vm',
            message: '',
          }),
      },
      { rbac: true },
    );
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule?catalog=otel-rules&name=vm&allowStorageChange=true',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'text/plain' },
      payload: 'metricsRules:\n  - name: vm_cpu',
    });
    expect(r.statusCode).toBe(200);
    const audit = ctx.audit.events.find((e) => e.action === 'addOrUpdate')!;
    expect(audit.verb).toBe('rule:write:structural');
    expect(audit.details).toMatchObject({ allowStorageChange: true });
    // The forwarded URL carries the flag.
    expect(ctx.oapCalls[0]!.url).toContain('allowStorageChange=true');
  });

  it('POST denies a user without the structural verb', async () => {
    ctx = await makeApp({}, { rbac: true });
    // Re-login as a reader-only user — but we only seeded admin. Patch
    // the session's roles directly for this test.
    // (Simpler: spin up a fresh app with a reader-only user.)
    await ctx.app.close();
    const cfg = makeConfig({
      users: [{ username: 'r', passwordHash: '$argon2id$pretend', roles: ['reader'] }],
      rbac: {
        enabled: true,
        roles: {
          reader: { verbs: ['rule:read', 'rule:write'] },
        },
      },
    });
    cfg.oap.adminUrls = ['http://oap-1:17128'];
    const config = staticConfig(cfg);
    const audit = createMemoryAuditLogger();
    const { fetch } = makeFetch({});
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
      payload: { username: 'r', password: 'pw' },
    });
    const sid = /sid=([^;]+)/.exec(login.headers['set-cookie'] as string)![1]!;
    const r = await built.app.inject({
      method: 'POST',
      url: '/api/rule?catalog=otel-rules&name=vm&force=true',
      headers: { cookie: `sid=${sid}`, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'permission_denied', verb: 'rule:write:structural' });
    await built.app.close();
    ctx.app = (await makeApp({})).app; // restore so afterEach has something to close
  });

  it('passes through 409 storage_change_requires_explicit_approval and audits it', async () => {
    ctx = await makeApp({
      addOrUpdate: () =>
        jsonResponse(
          {
            applyStatus: 'storage_change_requires_explicit_approval',
            catalog: 'otel-rules',
            name: 'vm',
            message: 'set allowStorageChange=true to proceed',
          },
          { status: 409 },
        ),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule?catalog=otel-rules&name=vm',
      headers: { cookie: `sid=${ctx.sid}`, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().applyStatus).toBe('storage_change_requires_explicit_approval');
    const audit = ctx.audit.events.find((e) => e.action === 'addOrUpdate')!;
    expect(audit.outcome).toBe('storage_change_requires_explicit_approval');
  });
});

describe('OAP route — /api/rule/inactivate + /delete', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('inactivate audits + returns the apply result', async () => {
    ctx = await makeApp({
      inactivate: () =>
        jsonResponse({
          applyStatus: 'no_change',
          catalog: 'otel-rules',
          name: 'vm',
          message: '',
        }),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule/inactivate?catalog=otel-rules&name=vm',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.audit.events.find((e) => e.action === 'inactivate')).toBeTruthy();
  });

  it('delete passes mode=revertToBundled through', async () => {
    ctx = await makeApp({
      delete: () =>
        jsonResponse({
          applyStatus: 'no_change',
          catalog: 'lal',
          name: 'envoy-als',
          message: '',
        }),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule/delete?catalog=lal&name=envoy-als&mode=revertToBundled',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.oapCalls[0]!.url).toContain('mode=revertToBundled');
    const audit = ctx.audit.events.find((e) => e.action === 'delete')!;
    expect(audit.details).toMatchObject({ mode: 'revertToBundled' });
  });

  it('delete with invalid mode rejects 400 without calling OAP', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule/delete?catalog=lal&name=x&mode=nuke',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_delete_mode');
    expect(ctx.oapCalls).toHaveLength(0);
  });

  it('delete forwards 409 requires_inactivate_first', async () => {
    ctx = await makeApp({
      delete: () =>
        jsonResponse(
          {
            applyStatus: 'requires_inactivate_first',
            catalog: 'otel-rules',
            name: 'vm',
            message: 'inactivate first',
          },
          { status: 409 },
        ),
    });
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/rule/delete?catalog=otel-rules&name=vm',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().applyStatus).toBe('requires_inactivate_first');
    const audit = ctx.audit.events.find((e) => e.action === 'delete')!;
    expect(audit.outcome).toBe('requires_inactivate_first');
  });
});

describe('OAP route — /api/cluster/state fan-out', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('fans out to every configured admin URL and pivots the result', async () => {
    const baseRule = {
      catalog: 'otel-rules',
      name: 'vm',
      status: 'ACTIVE',
      localState: 'RUNNING',
      suspendOrigin: 'NONE',
      loaderGc: 'LIVE',
      loaderKind: 'RUNTIME',
      loaderName: 'runtime:otel-rules/vm@0429-101900',
      bundled: false,
      updateTime: 1729999999000,
      lastApplyError: '',
      pendingUnregister: false,
    };
    ctx = await makeApp({
      perNodeList: {
        'oap-1': () =>
          jsonResponse({
            generatedAt: 1,
            loaderStats: { active: 1, pending: 0 },
            rules: [{ ...baseRule, contentHash: '7c3a' }],
          }),
        'oap-2': () =>
          jsonResponse({
            generatedAt: 2,
            loaderStats: { active: 1, pending: 0 },
            rules: [{ ...baseRule, contentHash: 'DIFF' }],
          }),
      },
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/cluster/state',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.nodes).toHaveLength(2);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].converged).toBe(false);
    expect(Object.keys(body.rules[0].perNode).sort()).toEqual([
      'http://oap-1:17128',
      'http://oap-2:17128',
    ]);
  });
});

describe('OAP route — /api/dump streaming', () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.app.close();
  });

  it('forwards content-type + content-disposition + body', async () => {
    const tarBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0]);
    ctx = await makeApp({
      dump: () =>
        new Response(tarBytes, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="runtime-rule-dump.tar.gz"',
          },
        }),
    });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/dump',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['content-disposition']).toContain('runtime-rule-dump.tar.gz');
  });

  it('rejects an unknown catalog on the path-param variant', async () => {
    ctx = await makeApp({});
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/dump/oal',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(400);
  });
});
