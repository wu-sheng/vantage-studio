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
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { isCatalog, type Catalog, type ListEnvelope } from '@vantage-studio/api-client';
import { bff } from '../api/client.js';
import { groupRules } from './components/grouping.js';
import RuleCard from './components/RuleCard.vue';
import Pill from '../design/primitives/Pill.vue';

const route = useRoute();

const catalog = computed<Catalog | null>(() => {
  const raw = route.params.catalog;
  return typeof raw === 'string' && isCatalog(raw) ? raw : null;
});

const query = useQuery({
  queryKey: computed(() => ['catalog/list', catalog.value]),
  queryFn: async (): Promise<ListEnvelope | null> => {
    if (!catalog.value) return null;
    return bff.catalogList(catalog.value);
  },
  enabled: computed(() => catalog.value !== null),
});

const groups = computed(() => {
  const env = query.data.value;
  if (!env) return [];
  return groupRules(env.rules);
});

const ruleCount = computed(() => query.data.value?.rules.length ?? 0);
const loaderStats = computed(() => query.data.value?.loaderStats ?? null);
</script>

<template>
  <div class="catalog">
    <header class="catalog__header">
      <h1 class="catalog__h1">
        Catalog · <span class="catalog__catalog">{{ catalog ?? 'unknown' }}</span>
      </h1>
      <Pill v-if="ruleCount > 0" tone="dim">{{ ruleCount }} rules</Pill>
      <Pill v-if="loaderStats && loaderStats.pending > 0" tone="warn">
        {{ loaderStats.pending }} loaders pending GC
      </Pill>
    </header>

    <div v-if="catalog === null" class="catalog__empty">
      Unknown catalog. Pick one from the left nav.
    </div>

    <div v-else-if="query.isPending.value" class="catalog__skeletons">
      <div v-for="n in 6" :key="n" class="catalog__skeleton" />
    </div>

    <div v-else-if="query.isError.value" class="catalog__error">
      Could not load <code>{{ catalog }}</code>.
      <button class="catalog__retry" type="button" @click="query.refetch()">retry</button>
    </div>

    <div v-else-if="ruleCount === 0" class="catalog__empty">
      <p>No rules in this catalog yet.</p>
      <p class="catalog__hint">
        Push one with <code>POST /runtime/rule/addOrUpdate</code> or its
        <code>swctl</code> equivalent.
      </p>
    </div>

    <section v-for="g in groups" :key="g.group" class="group">
      <header class="group__header">
        <span class="group__kicker">{{ g.group }}</span>
        <span class="group__count">{{ g.rules.length }}</span>
      </header>
      <div class="group__cards">
        <RuleCard v-for="rule in g.rules" :key="`${rule.catalog}/${rule.name}`" :rule="rule" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.catalog {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1400px;
}

.catalog__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.catalog__h1 {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  font-size: 18px;
  color: var(--rr-heading);
}

.catalog__catalog {
  font-family: var(--rr-font-mono);
  color: var(--rr-active);
}

.catalog__empty,
.catalog__error {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-ink2);
  padding: 32px 0;
}

.catalog__hint {
  font-size: 11px;
  color: var(--rr-dim);
}

.catalog__error code,
.catalog__hint code {
  font-family: var(--rr-font-mono);
  color: var(--rr-info);
}

.catalog__retry {
  margin-left: 8px;
  background: transparent;
  color: var(--rr-active);
  border: 1px solid var(--rr-active);
  padding: 2px 8px;
  border-radius: var(--rr-radius-md);
  cursor: pointer;
  font-family: var(--rr-font-mono);
  font-size: 10px;
}
.catalog__retry:hover {
  background: color-mix(in oklch, var(--rr-active) 15%, transparent);
}

.catalog__skeletons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.catalog__skeleton {
  width: 240px;
  height: 78px;
  border-radius: var(--rr-radius-md);
  background: linear-gradient(
    90deg,
    var(--rr-bg2) 0%,
    var(--rr-bg3) 50%,
    var(--rr-bg2) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border-bottom: 1px solid var(--rr-border);
  padding-bottom: 4px;
}

.group__kicker {
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.group__count {
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-dim);
}

.group__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
