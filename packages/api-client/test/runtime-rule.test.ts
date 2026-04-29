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

import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeRuleClient,
  RuntimeRuleApiError,
  type ApplyResult,
  type ListEnvelope,
} from '../src/index.js';

interface MockCall {
  url: string;
  init: RequestInit;
}

/** A tiny fake fetch that records every call and returns a pre-baked
 *  Response. Each test wires the response it wants. */
function makeFakeFetch(response: Response) {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init: init ?? {} });
    return response;
  });
  return { fn, calls };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const sampleEnvelope: ListEnvelope = {
  generatedAt: 1730000000000,
  loaderStats: { active: 14, pending: 1 },
  rules: [
    {
      catalog: 'otel-rules',
      name: 'vm',
      status: 'ACTIVE',
      localState: 'RUNNING',
      suspendOrigin: 'NONE',
      loaderGc: 'LIVE',
      loaderKind: 'RUNTIME',
      loaderName: 'runtime:otel-rules/vm@0429-101900',
      contentHash: '7c3a91',
      bundled: false,
      updateTime: 1729999999000,
      lastApplyError: '',
      pendingUnregister: false,
    },
    {
      catalog: 'log-mal-rules',
      name: 'access-log',
      status: 'BUNDLED',
      localState: 'RUNNING',
      loaderGc: 'LIVE',
      loaderKind: 'STATIC',
      loaderName: 'static:log-mal-rules/access-log@0429-101900',
      contentHash: '2d8e44',
      bundled: true,
      bundledContentHash: '2d8e44',
      pendingUnregister: false,
    },
    {
      catalog: 'lal',
      name: 'envoy-als',
      status: 'n/a',
      localState: 'NOT_LOADED',
      loaderGc: 'PENDING',
      loaderKind: 'NONE',
      loaderName: '',
      contentHash: '',
      bundled: true,
      bundledContentHash: 'b1d402',
      pendingUnregister: true,
    },
  ],
};

describe('RuntimeRuleClient.list', () => {
  it('parses the envelope with all three row kinds', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleEnvelope));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.list();

    expect(got.loaderStats.active).toBe(14);
    expect(got.rules).toHaveLength(3);
    expect(got.rules[0]!.status).toBe('ACTIVE');
    expect(got.rules[1]!.status).toBe('BUNDLED');
    expect(got.rules[2]!.status).toBe('n/a');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/rule/list');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('passes the catalog filter as a query string', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleEnvelope));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.list('otel-rules');

    expect(calls[0]!.url).toBe('http://oap:17128/runtime/rule/list?catalog=otel-rules');
  });
});

describe('RuntimeRuleClient.addOrUpdate', () => {
  it('serialises body + flags + returns ApplyResult on 200', async () => {
    const result: ApplyResult = {
      applyStatus: 'structural_applied',
      catalog: 'otel-rules',
      name: 'vm',
      message: 'ok',
    };
    const { fn, calls } = makeFakeFetch(jsonResponse(result));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.addOrUpdate({
      catalog: 'otel-rules',
      name: 'vm',
      body: 'metricsRules:\n  - name: vm_cpu',
      allowStorageChange: true,
      force: true,
    });

    expect(got.applyStatus).toBe('structural_applied');
    const sent = calls[0]!;
    expect(sent.init.method).toBe('POST');
    expect(sent.url).toContain('catalog=otel-rules');
    expect(sent.url).toContain('name=vm');
    expect(sent.url).toContain('allowStorageChange=true');
    expect(sent.url).toContain('force=true');
    expect((sent.init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(sent.init.body).toBe('metricsRules:\n  - name: vm_cpu');
  });

  it('throws RuntimeRuleApiError with the parsed body on 409', async () => {
    const errBody: ApplyResult = {
      applyStatus: 'storage_change_requires_explicit_approval',
      catalog: 'otel-rules',
      name: 'vm',
      message: 'set allowStorageChange=true to proceed',
    };
    const { fn } = makeFakeFetch(jsonResponse(errBody, { status: 409 }));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(
      client.addOrUpdate({ catalog: 'otel-rules', name: 'vm', body: 'x' }),
    ).rejects.toMatchObject({
      name: 'RuntimeRuleApiError',
      status: 409,
      body: { applyStatus: 'storage_change_requires_explicit_approval' },
    });
  });

  it('omits the flags when not set', async () => {
    const result: ApplyResult = {
      applyStatus: 'no_change',
      catalog: 'lal',
      name: 'envoy-als',
      message: '',
    };
    const { fn, calls } = makeFakeFetch(jsonResponse(result));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.addOrUpdate({ catalog: 'lal', name: 'envoy-als', body: 'x' });

    expect(calls[0]!.url).not.toContain('allowStorageChange');
    expect(calls[0]!.url).not.toContain('force');
  });
});

describe('RuntimeRuleClient.delete', () => {
  it('omits mode when default', async () => {
    const result: ApplyResult = {
      applyStatus: 'no_change',
      catalog: 'lal',
      name: 'x',
      message: '',
    };
    const { fn, calls } = makeFakeFetch(jsonResponse(result));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.delete('lal', 'x');

    expect(calls[0]!.url).not.toContain('mode=');
  });

  it('passes mode=revertToBundled', async () => {
    const result: ApplyResult = {
      applyStatus: 'no_change',
      catalog: 'lal',
      name: 'x',
      message: '',
    };
    const { fn, calls } = makeFakeFetch(jsonResponse(result));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.delete('lal', 'x', 'revertToBundled');

    expect(calls[0]!.url).toContain('mode=revertToBundled');
  });

  it('surfaces 409 requires_inactivate_first as RuntimeRuleApiError', async () => {
    const errBody: ApplyResult = {
      applyStatus: 'requires_inactivate_first',
      catalog: 'otel-rules',
      name: 'vm',
      message: 'inactivate first',
    };
    const { fn } = makeFakeFetch(jsonResponse(errBody, { status: 409 }));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(client.delete('otel-rules', 'vm')).rejects.toBeInstanceOf(RuntimeRuleApiError);
  });
});

describe('RuntimeRuleClient.get', () => {
  it('returns RuleResponse on 200', async () => {
    const headers = new Headers({
      'X-Sw-Content-Hash': '7c3a91',
      'X-Sw-Status': 'ACTIVE',
      'X-Sw-Source': 'runtime',
      'X-Sw-Update-Time': '1730000000000',
      ETag: '"7c3a91"',
      'Content-Type': 'application/x-yaml',
    });
    const response = new Response('metricsRules:\n  - name: vm_cpu', {
      status: 200,
      headers,
    });
    const { fn } = makeFakeFetch(response);
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.get({ catalog: 'otel-rules', name: 'vm' });

    expect('notModified' in got).toBe(false);
    if (!('notModified' in got)) {
      expect(got.status).toBe('ACTIVE');
      expect(got.contentHash).toBe('7c3a91');
      expect(got.etag).toBe('"7c3a91"');
      expect(got.content).toContain('vm_cpu');
    }
  });

  it('returns NotModified on 304', async () => {
    const headers = new Headers({
      'X-Sw-Content-Hash': '7c3a91',
      'X-Sw-Status': 'ACTIVE',
      ETag: '"7c3a91"',
    });
    const response = new Response(null, { status: 304, headers });
    const { fn, calls } = makeFakeFetch(response);
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.get({
      catalog: 'otel-rules',
      name: 'vm',
      ifNoneMatch: '"7c3a91"',
    });

    expect('notModified' in got).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>)['If-None-Match']).toBe('"7c3a91"');
  });

  it('passes source=bundled when requested', async () => {
    const response = new Response('bundled-yaml', {
      status: 200,
      headers: new Headers({
        'X-Sw-Source': 'static',
        'X-Sw-Content-Hash': 'aaa',
      }),
    });
    const { fn, calls } = makeFakeFetch(response);
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.get({ catalog: 'lal', name: 'envoy-als', source: 'bundled' });

    expect(calls[0]!.url).toContain('source=bundled');
  });
});

describe('RuntimeRuleClient.listBundled', () => {
  it('passes withContent and parses array', async () => {
    const body = [
      {
        name: 'envoy-als',
        kind: 'lal',
        contentHash: 'b1d402',
        content: 'filter { ... }',
        overridden: false,
      },
    ];
    const { fn, calls } = makeFakeFetch(jsonResponse(body));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listBundled('lal', false);

    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe('envoy-als');
    expect(calls[0]!.url).toContain('withContent=false');
  });
});

describe('RuntimeRuleClient.dump', () => {
  it('returns the raw Response so the caller can stream', async () => {
    const body = new Uint8Array([0x1f, 0x8b]); // gzip magic
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const { fn, calls } = makeFakeFetch(response);
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.dump('lal');

    expect(got.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/rule/dump/lal');
  });
});

describe('RuntimeRuleClient base URL handling', () => {
  it('strips a trailing slash on adminUrl', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleEnvelope));
    const client = new RuntimeRuleClient({ adminUrl: 'http://oap:17128/', fetch: fn });

    await client.list();

    expect(calls[0]!.url).toBe('http://oap:17128/runtime/rule/list');
  });
});
