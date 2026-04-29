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
import { isCatalog } from '@vantage-studio/api-client';
import Section from '../design/primitives/Section.vue';
import Pill from '../design/primitives/Pill.vue';

const route = useRoute();
const catalog = computed(() => {
  const raw = route.params.catalog;
  return typeof raw === 'string' && isCatalog(raw) ? raw : null;
});
</script>

<template>
  <div class="catalog">
    <div class="catalog__header">
      <h1 class="catalog__h1">
        Catalog · <span class="catalog__catalog">{{ catalog ?? 'unknown' }}</span>
      </h1>
      <Pill tone="info">phase 5 will populate this</Pill>
    </div>

    <Section title="Rules" kicker="grouped cards">
      <p class="catalog__placeholder">
        Phase 5 wires this view to <code>GET /api/catalog/list</code>. Each rule renders
        as a grouped card with status, override, and modified-from-bundled badges
        computed entirely from the <code>/list</code> envelope (no second roundtrip).
      </p>
    </Section>
  </div>
</template>

<style scoped>
.catalog {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1200px;
}

.catalog__header {
  display: flex;
  align-items: center;
  gap: 14px;
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

.catalog__placeholder {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--rr-ink2);
}

.catalog__placeholder code {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-info);
}
</style>
