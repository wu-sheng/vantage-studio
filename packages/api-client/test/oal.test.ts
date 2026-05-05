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
  OalClient,
  RuntimeRuleApiError,
  type OalFileDetail,
  type OalFileListing,
  type OalRuleSnapshot,
} from '../src/index.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface MockCall {
  url: string;
  init: RequestInit;
}

function makeFakeFetch(...responses: Response[]) {
  const calls: MockCall[] = [];
  const queue = [...responses];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init: init ?? {} });
    return queue.shift() ?? new Response('exhausted', { status: 500 });
  });
  return { fn, calls };
}

const sampleFiles: OalFileListing[] = [
  {
    name: 'core',
    path: 'core.oal',
    ruleCount: 86,
    status: 'LOADED',
    contentHash: '8a21f000aaaa',
  },
  {
    name: 'browser',
    path: 'browser.oal',
    ruleCount: 14,
    status: 'LOADED',
    contentHash: '5e1c44ddee',
  },
];

const sampleRule: OalRuleSnapshot = {
  file: 'core',
  ruleName: 'endpoint_cpm',
  line: 14,
  sourceScope: 'Endpoint',
  expression: 'endpoint_cpm = from(Endpoint.*).cpm();',
  function: 'cpm',
  filters: [],
  persistedMetricName: 'endpoint_cpm',
  contentHash: '8a21f000aaaa',
};

const sampleFileDetail: OalFileDetail = {
  name: 'core',
  path: 'core.oal',
  content: 'endpoint_cpm = from(Endpoint.*).cpm();\n',
  rules: [sampleRule],
  status: 'LOADED',
  contentHash: '8a21f000aaaa',
};

describe('OalClient', () => {
  it('listFiles hits /runtime/oal/files and returns the array', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleFiles));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listFiles();

    expect(got).toHaveLength(2);
    expect(got[0]!.name).toBe('core');
    expect(got[0]!.contentHash).toBe('8a21f000aaaa');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/files');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('getFile encodes the path segment and returns the detail', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleFileDetail));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.getFile('core');

    expect(got).not.toBeNull();
    expect(got!.rules).toHaveLength(1);
    expect(got!.rules[0]!.ruleName).toBe('endpoint_cpm');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/files/core');
  });

  it('getFile returns null on 404', async () => {
    const { fn } = makeFakeFetch(new Response('not_found', { status: 404 }));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    expect(await client.getFile('missing')).toBeNull();
  });

  it('listRules hits /runtime/oal/rules', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse([sampleRule]));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listRules();

    expect(got).toHaveLength(1);
    expect(got[0]!.contentHash).toBe('8a21f000aaaa');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/rules');
  });

  it('getRule encodes the rule-name path segment', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleRule));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.getRule('endpoint_cpm');

    expect(got).not.toBeNull();
    expect(got!.ruleName).toBe('endpoint_cpm');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/rules/endpoint_cpm');
  });

  it('getRule returns null on 404', async () => {
    const { fn } = makeFakeFetch(new Response('not_found', { status: 404 }));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    expect(await client.getRule('missing')).toBeNull();
  });

  it('throws RuntimeRuleApiError for non-2xx, non-404 responses', async () => {
    const { fn } = makeFakeFetch(
      new Response(JSON.stringify({ applyStatus: 'oap_unreachable', message: 'down' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(client.listFiles()).rejects.toBeInstanceOf(RuntimeRuleApiError);
  });
});
