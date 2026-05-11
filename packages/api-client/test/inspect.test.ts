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
  InspectApiError,
  InspectClient,
  INSPECT_ENTITY_LIMIT_MAX,
  formatInspectDate,
  isInspectDate,
  type EntitiesResponse,
  type MetricsResponse,
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

// Real /inspect/metrics fixture shape from the e2e suite. Three rows
// cover REGULAR_VALUE, LABELED_VALUE, and HEATMAP so the wire types
// accept the full mix.
const sampleMetrics: MetricsResponse = {
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
    {
      name: 'service_percentile',
      type: 'LABELED_VALUE',
      catalog: 'SERVICE',
      scopeId: 1,
      scope: 'Service',
      valueColumnName: 'value',
      downsamplings: ['MINUTE', 'HOUR', 'DAY'],
    },
    {
      name: 'endpoint_response_time',
      type: 'HEATMAP',
      catalog: 'ENDPOINT',
      scopeId: 3,
      scope: 'Endpoint',
      valueColumnName: 'dataset',
      downsamplings: ['MINUTE', 'HOUR', 'DAY'],
    },
  ],
};

// Real /inspect/entities fixture: a Service-scope row at GENERAL layer.
const sampleEntities: EntitiesResponse = {
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
};

describe('InspectClient.listMetrics', () => {
  it('returns the catalog with no params', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleMetrics));
    const client = new InspectClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listMetrics();

    expect(got.metrics).toHaveLength(3);
    expect(got.metrics[0]!.name).toBe('service_cpm');
    expect(calls[0]!.url).toBe('http://oap:17128/inspect/metrics');
  });

  it('appends type / catalog as repeatable params and mqeQueryable as a flag', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse({ metrics: [] }));
    const client = new InspectClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await client.listMetrics({
      regex: 'service_.*',
      type: ['REGULAR_VALUE', 'LABELED_VALUE'],
      catalog: ['SERVICE'],
      mqeQueryable: true,
    });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/inspect/metrics');
    expect(url.searchParams.get('regex')).toBe('service_.*');
    expect(url.searchParams.getAll('type')).toEqual(['REGULAR_VALUE', 'LABELED_VALUE']);
    expect(url.searchParams.getAll('catalog')).toEqual(['SERVICE']);
    expect(url.searchParams.get('mqeQueryable')).toBe('true');
  });

  it('throws InspectApiError carrying the OAP error body', async () => {
    const { fn } = makeFakeFetch(
      new Response(JSON.stringify({ error: 'something blew up' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new InspectClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(client.listMetrics()).rejects.toMatchObject({
      name: 'InspectApiError',
      status: 500,
      body: { error: 'something blew up' },
    });
  });
});

describe('InspectClient.listEntities', () => {
  it('builds the right query string and parses the response', async () => {
    const { fn, calls } = makeFakeFetch(jsonResponse(sampleEntities));
    const client = new InspectClient({ adminUrl: 'http://oap:17128', fetch: fn });

    const got = await client.listEntities({
      metric: 'service_cpm',
      start: '2026-05-10 1220',
      end: '2026-05-10 1240',
      step: 'MINUTE',
      limit: 10,
    });

    expect(got.rows[0]!.entityId).toBe('cGF5bWVudA==.1');
    expect(got.rows[0]!.mqeEntity.serviceName).toBe('payment');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/inspect/entities');
    expect(url.searchParams.get('metric')).toBe('service_cpm');
    expect(url.searchParams.get('start')).toBe('2026-05-10 1220');
    expect(url.searchParams.get('end')).toBe('2026-05-10 1240');
    expect(url.searchParams.get('step')).toBe('MINUTE');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('translates OAP 400 errors to InspectApiError', async () => {
    const { fn } = makeFakeFetch(
      new Response(JSON.stringify({ error: 'unknown metric: foo' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new InspectClient({ adminUrl: 'http://oap:17128', fetch: fn });

    await expect(
      client.listEntities({ metric: 'foo', start: '2026-05-10', end: '2026-05-10', step: 'DAY' }),
    ).rejects.toBeInstanceOf(InspectApiError);
  });
});

describe('formatInspectDate / isInspectDate', () => {
  // Fix a known instant so the test isn't TZ-sensitive: 2026-05-10
  // 12:34 UTC. The formatter is UTC-anchored, mirroring how OAP runs
  // in container deployments.
  const d = new Date(Date.UTC(2026, 4, 10, 12, 34, 56));

  it('formats DAY as yyyy-MM-dd', () => {
    expect(formatInspectDate(d, 'DAY')).toBe('2026-05-10');
  });

  it('formats HOUR as yyyy-MM-dd HH', () => {
    expect(formatInspectDate(d, 'HOUR')).toBe('2026-05-10 12');
  });

  it('formats MINUTE as yyyy-MM-dd HHmm', () => {
    expect(formatInspectDate(d, 'MINUTE')).toBe('2026-05-10 1234');
  });

  it('isInspectDate validates each step format', () => {
    expect(isInspectDate('2026-05-10', 'DAY')).toBe(true);
    expect(isInspectDate('2026-05-10 12', 'HOUR')).toBe(true);
    expect(isInspectDate('2026-05-10 1234', 'MINUTE')).toBe(true);
    expect(isInspectDate('2026-05-10', 'MINUTE')).toBe(false);
    expect(isInspectDate('2026/05/10', 'DAY')).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the server-side cap', () => {
    expect(INSPECT_ENTITY_LIMIT_MAX).toBe(300);
  });
});
