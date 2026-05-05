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
  type OalFilesResponse,
  type OalRulesResponse,
  type OalSourceDetail,
} from '../src/index.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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

const sampleFiles: OalFilesResponse = {
  files: ['core.oal', 'browser.oal'],
  count: 2,
};

const sampleRules: OalRulesResponse = {
  sources: [
    {
      source: 'Endpoint',
      dispatcher: 'org.apache.skywalking.oap.server.core.source.EndpointDispatcher',
      metrics: ['endpoint_cpm', 'endpoint_sla'],
    },
  ],
  count: 1,
};

const sampleDetail: OalSourceDetail = {
  source: 'Endpoint',
  dispatcher: 'org.apache.skywalking.oap.server.core.source.EndpointDispatcher',
  status: 'live',
  metrics: ['endpoint_cpm', 'endpoint_sla'],
};

describe('OalClient', () => {
  it('listFiles hits /runtime/oal/files and returns the JSON envelope', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleFiles));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listFiles();

    expect(got.files).toHaveLength(2);
    expect(got.files[0]).toBe('core.oal');
    expect(got.count).toBe(2);
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/files');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('getFileContent fetches text/plain and returns the body string', async () => {
    const { fn, calls } = makeFakeFetch(textResponse('// core.oal\nendpoint_cpm = ...\n'));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.getFileContent('core.oal');

    expect(got).toBe('// core.oal\nendpoint_cpm = ...\n');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/files/core.oal');
  });

  it('getFileContent returns null on 404', async () => {
    const { fn } = makeFakeFetch(new Response('not loaded', { status: 404 }));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    expect(await client.getFileContent('missing.oal')).toBeNull();
  });

  it('listSources hits /runtime/oal/rules and returns the per-dispatcher listing', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleRules));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listSources();

    expect(got.sources).toHaveLength(1);
    expect(got.sources[0]!.source).toBe('Endpoint');
    expect(got.sources[0]!.metrics).toEqual(['endpoint_cpm', 'endpoint_sla']);
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/rules');
  });

  it('getSource encodes the path segment and returns the detail', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleDetail));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.getSource('Endpoint');

    expect(got).not.toBeNull();
    expect(got!.status).toBe('live');
    expect(calls[0]!.url).toBe('http://oap:17128/runtime/oal/rules/Endpoint');
  });

  it('getSource returns null on 404', async () => {
    const { fn } = makeFakeFetch(new Response('not found', { status: 404 }));
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    expect(await client.getSource('Bogus')).toBeNull();
  });

  it('throws RuntimeRuleApiError for non-2xx, non-404 responses', async () => {
    const { fn } = makeFakeFetch(
      new Response(JSON.stringify({ status: 'error', code: 'oap_unreachable', message: 'down' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new OalClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(client.listFiles()).rejects.toBeInstanceOf(RuntimeRuleApiError);
  });
});
