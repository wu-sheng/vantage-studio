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

const sampleResponse = {
  generatedAt: 1730000000000,
  nodes: [
    { url: 'http://oap-1:17128', ok: true },
    { url: 'http://oap-2:17128', ok: false, error: 'ECONNREFUSED' },
  ],
  rules: [
    {
      catalog: 'otel-rules',
      name: 'vm',
      converged: false,
      perNode: {
        'http://oap-1:17128': {
          status: 'ACTIVE',
          localState: 'RUNNING',
          contentHash: '7c3a91',
          lastApplyError: '',
        },
      },
    },
    {
      catalog: 'lal',
      name: 'envoy-als',
      converged: true,
      perNode: {
        'http://oap-1:17128': {
          status: 'BUNDLED',
          localState: 'RUNNING',
          contentHash: 'b1d402',
          lastApplyError: '',
        },
      },
    },
  ],
};

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

  it('renders the per-node strip and per-rule matrix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/api/cluster/state')) return jsonResponse(sampleResponse);
        throw new Error(`unmocked: ${String(input)}`);
      }),
    );

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('oap-1:17128');
    expect(text).toContain('oap-2:17128');
    expect(text).toContain('ECONNREFUSED');
    expect(text).toContain('vm');
    expect(text).toContain('envoy-als');
    expect(text.toLowerCase()).toContain('1 diverged'); // header summary
  });

  it('shows the empty state when no rules are returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ generatedAt: 0, nodes: [], rules: [] })),
    );

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('no rules in the cluster');
  });

  it('flags errors in the header summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          generatedAt: 0,
          nodes: [{ url: 'http://oap-1:17128', ok: true }],
          rules: [
            {
              catalog: 'otel-rules',
              name: 'vm',
              converged: true,
              perNode: {
                'http://oap-1:17128': {
                  status: 'ACTIVE',
                  localState: 'RUNNING',
                  contentHash: '7c3a91',
                  lastApplyError: 'ddl_verify_failed: …',
                },
              },
            },
          ],
        }),
      ),
    );

    const wrapper = mount(ClusterStatus, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    expect(wrapper.text().toLowerCase()).toContain('1 with errors');
  });
});
