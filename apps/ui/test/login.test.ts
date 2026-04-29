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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../src/views/Login.vue';

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/login', name: 'login', component: Login },
    ],
  });
}

describe('Login.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('submits credentials to /api/auth/login and routes home on 200', async () => {
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            username: 'alice',
            roles: ['admin'],
            verbs: ['*'],
            expiresAt: Date.now() + 60_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unmocked: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const router = makeRouter();
    await router.push('/login');
    await router.isReady();

    const wrapper = mount(Login, {
      global: { plugins: [router] },
    });

    await wrapper.find('[data-testid="login-username"]').setValue('alice');
    await wrapper.find('[data-testid="login-password"]').setValue('pw');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ username: 'alice', password: 'pw' }));
    expect(router.currentRoute.value.name).toBe('home');

    vi.unstubAllGlobals();
  });

  it('shows the invalid-credentials message on 401', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'unauthenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const router = makeRouter();
    await router.push('/login');
    await router.isReady();

    const wrapper = mount(Login, {
      global: { plugins: [router] },
    });

    await wrapper.find('[data-testid="login-username"]').setValue('alice');
    await wrapper.find('[data-testid="login-password"]').setValue('wrong');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    const err = wrapper.find('[data-testid="login-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('invalid');
    expect(router.currentRoute.value.name).toBe('login');

    vi.unstubAllGlobals();
  });
});
