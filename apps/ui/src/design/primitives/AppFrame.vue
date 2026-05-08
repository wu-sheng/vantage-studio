<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '../../stores/auth.js';
import { useQuery } from '@tanstack/vue-query';
import { bff } from '../../api/client.js';
import CatalogNav from './CatalogNav.vue';
import Btn from './Btn.vue';
import Pill from './Pill.vue';

const auth = useAuthStore();

async function logout(): Promise<void> {
  await auth.logout();
  // Full-page reload so the next session starts cleanly: no
  // lingering `?redirect=` query, no stale vue-query cache, no
  // pinia state carry-over.
  window.location.assign('/login');
}

/** Cluster-wide DSL classloader posture. `loaderStats` is global on
 *  every `/runtime/rule/list` response (the catalog filter narrows
 *  `rules[]`, not `loaderStats`), so the right home for it is the
 *  app-shell header — visible from every page. Refetched every 15 s
 *  while the user is authenticated. */
const loaderStatsQuery = useQuery({
  queryKey: ['app/loaderStats'],
  queryFn: async () => {
    const env = await bff.catalogList();
    return env.loaderStats;
  },
  enabled: computed(() => auth.user !== null),
  refetchInterval: 15_000,
});

const loaderStats = computed(() => loaderStatsQuery.data.value ?? null);
</script>

<template>
  <div class="appframe">
    <header class="appframe__header">
      <router-link to="/" class="appframe__brand" aria-label="Vantage Studio · home">
        <img class="appframe__logo" src="/vs-logo-mark.png" alt="" decoding="async" />
        <span class="appframe__title">VANTAGE STUDIO</span>
      </router-link>
      <div class="appframe__spacer" />
      <div v-if="loaderStats" class="appframe__loaders" title="DSL classloader posture (cluster-global from /runtime/rule/list)">
        <span class="appframe__loaderlbl">loaders</span>
        <Pill tone="dim">{{ loaderStats.active }} active</Pill>
        <Pill v-if="loaderStats.pending > 0" tone="warn">{{ loaderStats.pending }} pending GC</Pill>
      </div>
      <div v-if="auth.user" class="appframe__user">
        <span class="appframe__userlabel">{{ auth.user.username }}</span>
        <Btn kind="ghost" size="sm" @click="logout">logout</Btn>
      </div>
    </header>
    <div class="appframe__body">
      <aside class="appframe__nav">
        <CatalogNav />
      </aside>
      <main class="appframe__main">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.appframe {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--rr-bg);
  color: var(--rr-ink);
}

.appframe__header {
  display: flex;
  align-items: center;
  /* Bar background = #1c2630 (matches `--rr-bg3`, the elevated
     surface tone). The logo PNG was re-baked with the same
     #1c2630 ground baked in, so the rectangular outline of the
     PNG dissolves into the bar at every size — no visible
     image edge. */
  height: 64px;
  padding: 0 20px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
  gap: 18px;
  flex-shrink: 0;
  /* Hairline crimson glow at the bottom edge picks up the brand
     accent. */
  box-shadow: inset 0 -1px 0 0 color-mix(in oklab, var(--rr-accent) 30%, transparent);
}

.appframe__brand {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  text-decoration: none;
  color: inherit;
}
.appframe__brand:hover {
  text-decoration: none;
}

.appframe__logo {
  display: block;
  height: 52px;
  width: auto;
}

.appframe__title {
  font-family: var(--rr-font-mono);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 2.6px;
  color: var(--rr-heading);
}

.appframe__spacer {
  flex: 1 1 auto;
}

.appframe__user {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--rr-font-mono);
  font-size: 14px;
  color: var(--rr-ink2);
}

.appframe__loaders {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--rr-font-mono);
  font-size: 14px;
  color: var(--rr-ink2);
}

.appframe__loaderlbl {
  color: var(--rr-dim);
  font-size: 12px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  font-weight: 700;
}

.appframe__userlabel {
  letter-spacing: 0.3px;
}

.appframe__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.appframe__nav {
  width: 220px;
  background: var(--rr-bg);
  border-right: 1px solid var(--rr-border);
  flex-shrink: 0;
  overflow: auto;
}

.appframe__main {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  background: var(--rr-bg);
}
</style>
