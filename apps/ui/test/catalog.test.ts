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
import { createRouter, createMemoryHistory } from 'vue-router';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Catalog from '../src/views/Catalog.vue';
import Editor from '../src/views/Editor.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/catalog/:catalog',
        name: 'catalog',
        component: Catalog,
        props: true,
      },
      { path: '/edit', name: 'edit', component: Editor },
    ],
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const baseRow = {
  catalog: 'otel-rules',
  status: 'ACTIVE',
  localState: 'RUNNING',
  suspendOrigin: 'NONE',
  loaderGc: 'LIVE',
  loaderKind: 'RUNTIME',
  loaderName: 'runtime:otel-rules/vm@0429',
  bundled: false,
  updateTime: 1730000000000,
  lastApplyError: '',
  pendingUnregister: false,
};

const sampleEnvelope = {
  generatedAt: 1730000000000,
  loaderStats: { active: 3, pending: 0 },
  rules: [
    { ...baseRow, name: 'vm', contentHash: '7c3a91' },
    {
      ...baseRow,
      name: 'k8s/pod',
      contentHash: 'a02cff',
      bundled: true,
      bundledContentHash: 'a02cff',
    },
    {
      ...baseRow,
      name: 'k8s/node',
      contentHash: '4fe810',
      bundled: true,
      bundledContentHash: 'OTHER',
      localState: 'SUSPENDED',
    },
  ],
};

describe('Catalog.vue', () => {
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

  it('renders grouped cards from /api/catalog/list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('/api/catalog/list')) {
          return jsonResponse(sampleEnvelope);
        }
        throw new Error(`unmocked: ${String(input)}`);
      }),
    );

    const router = makeRouter();
    await router.push('/catalog/otel-rules');
    await router.isReady();

    const wrapper = mount(Catalog, {
      global: {
        plugins: [router, [VueQueryPlugin, { queryClient }]],
      },
    });
    await flushPromises();

    expect(wrapper.html()).toContain('vm');
    expect(wrapper.html()).toContain('k8s/pod');
    expect(wrapper.html()).toContain('k8s/node');

    // Group "k8s" rendered before the "(top level)" group.
    const text = wrapper.text();
    expect(text.indexOf('k8s')).toBeLessThan(text.indexOf('(top level)'));

    // Override badges: k8s/pod = override (hashes match), k8s/node = modified.
    expect(text.toLowerCase()).toContain('override');
    expect(text.toLowerCase()).toContain('modified');

    // Suspended rule shows the "applying…" hint.
    expect(text.toLowerCase()).toContain('applying');
  });

  it('routes to /edit?catalog=&name= on card click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(sampleEnvelope)),
    );

    const router = makeRouter();
    await router.push('/catalog/otel-rules');
    await router.isReady();

    const wrapper = mount(Catalog, {
      global: {
        plugins: [router, [VueQueryPlugin, { queryClient }]],
      },
    });
    await flushPromises();

    await wrapper.find('[data-testid="rule-card-vm"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('edit');
    expect(router.currentRoute.value.query).toEqual({ catalog: 'otel-rules', name: 'vm' });
  });

  it('shows the empty state when the envelope has no rules', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ generatedAt: 0, loaderStats: { active: 0, pending: 0 }, rules: [] }),
      ),
    );

    const router = makeRouter();
    await router.push('/catalog/otel-rules');
    await router.isReady();

    const wrapper = mount(Catalog, {
      global: {
        plugins: [router, [VueQueryPlugin, { queryClient }]],
      },
    });
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('no rules');
  });

  it('shows the error state with a retry button when the call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    );

    const router = makeRouter();
    await router.push('/catalog/otel-rules');
    await router.isReady();

    const wrapper = mount(Catalog, {
      global: {
        plugins: [router, [VueQueryPlugin, { queryClient }]],
      },
    });
    await flushPromises();

    expect(wrapper.text().toLowerCase()).toContain('could not load');
    expect(wrapper.find('.catalog__retry').exists()).toBe(true);
  });
});
