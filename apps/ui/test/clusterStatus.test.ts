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

import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterStatus from '../src/views/ClusterStatus.vue';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/**
 * The cluster page renders two sections: per-node reachability and
 * the dsl-debugging health table. The rules-matrix section was
 * removed (it overlapped the catalog browse + duplicated the cluster
 * page's purpose); these tests cover what's actually on the page now.
 */

const sampleClusterState = {
  generatedAt: 1730000000000,
  nodes: [
    { url: 'http://oap-1:17128', ok: true },
    { url: 'http://oap-2:17128', ok: false, error: 'ECONNREFUSED' },
  ],
  rules: [],
};

const sampleDebugStatus = {
  generatedAt: 1730000000000,
  nodes: [
    {
      url: 'http://oap-1:17128',
      ok: true,
      status: {
        module: 'dsl-debugging',
        phase: 'phase-4',
        nodeId: '0.0.0.0_11800',
        injectionEnabled: true,
        activeSessions: 2,
      },
    },
    {
      url: 'http://oap-2:17128',
      ok: false,
      error: 'ECONNREFUSED',
    },
  ],
};

function fetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL) => {
    const u = String(input);
    if (u.includes('/api/cluster/state')) return jsonResponse(sampleClusterState);
    if (u.includes('/api/debug/status')) return jsonResponse(sampleDebugStatus);
    throw new Error(`unmocked: ${u}`);
  });
}

describe('ClusterStatus.vue', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    setActivePinia(createPinia());
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the per-node strip with reachability error labels', async () => {
    vi.stubGlobal('fetch', fetchMock());

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('oap-1:17128');
    expect(text).toContain('oap-2:17128');
    expect(text).toContain('ECONNREFUSED');
  });

  it('renders the dsl-debugging health table with injection + active-session columns', async () => {
    vi.stubGlobal('fetch', fetchMock());

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    const text = wrapper.text().toLowerCase();
    expect(text).toContain('dsl-debugging');
    // Reachable node shows enabled / 2 active sessions.
    expect(text).toContain('enabled');
    // Unreachable node shows the unreachable pill + the RPC error.
    expect(text).toContain('unreachable');
  });

  it('falls back to the placeholder when /api/debug/status fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u.includes('/api/cluster/state')) return jsonResponse(sampleClusterState);
        if (u.includes('/api/debug/status')) return new Response('boom', { status: 500 });
        throw new Error(`unmocked: ${u}`);
      }),
    );

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('could not load');
  });
});
