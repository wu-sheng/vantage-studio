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

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import App from './App.vue';
import { router } from './router.js';
import { setOn401 } from './api/client.js';
import { useAuthStore } from './stores/auth.js';

import '@vantage-studio/design-tokens/tokens.css';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // Refetching on window focus is the right default for the
      // catalog matrix — operators want fresh state when they tab
      // back. The editor (phase 6) opts out per-query.
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient });

/**
 * Mid-session 401 → reset auth + redirect to /login. Idempotent —
 * concurrent 401s on parallel requests should only redirect once. We
 * use a dedupe flag and `window.location.assign` (not router.push) so
 * the entire app state — vue-query cache, debug-session pollers,
 * pinia stores — is fully reset and there's no chance of stale data
 * flashing into the next session.
 */
let redirecting = false;
setOn401(() => {
  if (redirecting) return;
  redirecting = true;
  try {
    const auth = useAuthStore();
    auth.user = null;
  } catch {
    // Pinia not yet active during very-early-boot 401; ignore.
  }
  if (window.location.pathname === '/login') {
    redirecting = false;
    return;
  }
  const redirectQs =
    encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?redirect=${redirectQs}`);
});

app.mount('#app');
