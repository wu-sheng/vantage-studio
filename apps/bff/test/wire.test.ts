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
import { createMemoryWireLogger, redactHeaders, truncate } from '../src/wire/logger.js';
import { makeWireFetch } from '../src/wire/fetch.js';
import { makeConfig } from './helpers.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('wire/logger helpers', () => {
  it('truncate adds the chars-truncated marker past the cap', () => {
    expect(truncate('abcdef', 6)).toBe('abcdef');
    expect(truncate('abcdefgh', 4)).toBe('abcd… +4 chars truncated');
    expect(truncate(undefined, 4)).toBeUndefined();
  });

  it('redactHeaders strips Cookie/Authorization when redactAuth=true', () => {
    const got = redactHeaders(
      {
        cookie: 'sid=secret',
        authorization: 'Bearer x',
        'content-type': 'application/json',
      },
      true,
    );
    expect(got.cookie).toBe('<redacted>');
    expect(got.authorization).toBe('<redacted>');
    expect(got['content-type']).toBe('application/json');
  });

  it('redactHeaders passes everything when redactAuth=false', () => {
    const got = redactHeaders({ cookie: 'sid=secret' }, false);
    expect(got.cookie).toBe('sid=secret');
  });
});

describe('wire/fetch wrapper', () => {
  it('logs outbound request and response with shared traceId', async () => {
    const wire = createMemoryWireLogger();
    const base: FetchLike = async () => jsonResponse({ ok: true });
    const wrapped = makeWireFetch(base, wire, { redactAuthHeaders: true });

    await wrapped('http://oap:17128/runtime/rule/list', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    expect(wire.events).toHaveLength(1);
    const evt = wire.events[0]!;
    expect(evt.direction).toBe('outbound');
    expect(evt.method).toBe('GET');
    expect(evt.url).toBe('http://oap:17128/runtime/rule/list');
    expect(evt.status).toBe(200);
    expect(evt.resBody).toContain('"ok":true');
  });

  it('does nothing when disabled', async () => {
    const wire = createMemoryWireLogger();
    wire.setEnabled(false);
    const base: FetchLike = async () => jsonResponse({ ok: true });
    const wrapped = makeWireFetch(base, wire, { redactAuthHeaders: true });

    await wrapped('http://oap:17128/runtime/rule/list', { method: 'GET' });

    expect(wire.events).toHaveLength(0);
  });

  it('captures errors with the error field', async () => {
    const wire = createMemoryWireLogger();
    const base: FetchLike = async () => {
      throw new Error('connection refused');
    };
    const wrapped = makeWireFetch(base, wire, { redactAuthHeaders: true });

    await expect(wrapped('http://oap:17128/runtime/rule/list', { method: 'GET' })).rejects.toThrow();
    expect(wire.events).toHaveLength(1);
    expect(wire.events[0]!.error).toBe('connection refused');
    expect(wire.events[0]!.status).toBeUndefined();
  });

  it('truncates response bodies past the cap', async () => {
    const wire = createMemoryWireLogger({ maxBodyChars: 16 });
    const base: FetchLike = async () =>
      new Response('abcdefghijklmnopqrstuvwxyz', { status: 200 });
    const wrapped = makeWireFetch(base, wire, { redactAuthHeaders: true });

    await wrapped('http://oap:17128/x', { method: 'GET' });

    expect(wire.events[0]!.resBody).toContain('chars truncated');
  });
});

describe('wire hook integration via /api/*', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  async function buildWithWire(opts: {
    enabled: boolean;
    oapFetch: FetchLike;
  }): Promise<{
    app: FastifyInstance;
    wire: ReturnType<typeof createMemoryWireLogger>;
    sid: string;
  }> {
    const cfg = makeConfig({ users: [{ username: 'alice', passwordHash: 'x', roles: ['admin'] }] });
    cfg.debugLog = {
      enabled: opts.enabled,
      file: '/tmp/wire.jsonl',
      maxBodyChars: 8192,
      redactAuthHeaders: true,
    };
    const config = staticConfig(cfg);
    const wire = createMemoryWireLogger({ enabled: opts.enabled });
    const audit = createMemoryAuditLogger();
    const built = await buildServer({
      config,
      audit,
      wire,
      oapFetch: opts.oapFetch,
      loggerOptions: false,
      verifyDeps: { verify: async () => true },
    });
    const login = await built.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pw' },
    });
    const setCookie = login.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie as string);
    const sid = /sid=([^;]+)/.exec(cookieStr)![1]!;
    return { app: built.app, wire, sid };
  }

  it('logs inbound + outbound with the same traceId', async () => {
    const fetchStub: FetchLike = async () =>
      jsonResponse({ generatedAt: 1, loaderStats: { active: 0, pending: 0 }, rules: [] });
    const ctx = await buildWithWire({ enabled: true, oapFetch: fetchStub });
    app = ctx.app;

    // Login already produced inbound events; clear them so we test
    // a single API call cleanly.
    ctx.wire.events.length = 0;

    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/list?catalog=otel-rules',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(r.statusCode).toBe(200);

    const events = ctx.wire.events;
    const inbound = events.find((e) => e.direction === 'inbound');
    const outbound = events.find((e) => e.direction === 'outbound');
    expect(inbound).toBeDefined();
    expect(outbound).toBeDefined();
    expect(inbound!.url).toContain('/api/catalog/list');
    expect(outbound!.url).toContain('/runtime/rule/list');
    expect(inbound!.traceId).toBe(outbound!.traceId);
    expect(inbound!.status).toBe(200);
    expect(outbound!.status).toBe(200);
  });

  it('redacts /api/auth/login request body', async () => {
    const fetchStub: FetchLike = async () => new Response('', { status: 500 });
    const ctx = await buildWithWire({ enabled: true, oapFetch: fetchStub });
    app = ctx.app;

    // The login during setup already produced an event; find it.
    const loginEvent = ctx.wire.events.find(
      (e) => e.direction === 'inbound' && e.url === '/api/auth/login',
    );
    expect(loginEvent).toBeDefined();
    expect(loginEvent!.reqBody).toContain('redacted');
    expect(loginEvent!.reqBody).not.toContain('"password":"pw"');
  });

  it('does not log when disabled', async () => {
    const fetchStub: FetchLike = async () =>
      jsonResponse({ generatedAt: 1, loaderStats: { active: 0, pending: 0 }, rules: [] });
    const ctx = await buildWithWire({ enabled: false, oapFetch: fetchStub });
    app = ctx.app;

    await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/list?catalog=otel-rules',
      headers: { cookie: `sid=${ctx.sid}` },
    });
    expect(ctx.wire.events).toHaveLength(0);
  });
});
