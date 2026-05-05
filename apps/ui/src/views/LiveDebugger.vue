<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * Live debugger — three-tab shell over MAL / LAL / OAL views.
 * Each tab owns its own session via the per-widget clientId so an
 * operator can have all three running in parallel from the same
 * tab.
 *
 * SWIP-13 §7 locked the three views; this is the entry point.
 */
import { computed, ref } from 'vue';
import DebugMal from './debug/DebugMal.vue';
import DebugLal from './debug/DebugLal.vue';
import DebugOal from './debug/DebugOal.vue';

type Tab = 'mal' | 'lal' | 'oal';

const tab = ref<Tab>('mal');

const tabs: { id: Tab; label: string; hint: string }[] = [
  { id: 'mal', label: 'MAL', hint: 'meter analyzer · OTEL + log-mal' },
  { id: 'lal', label: 'LAL', hint: 'log analyzer · per-block + statement' },
  { id: 'oal', label: 'OAL', hint: 'observability analysis · per-clause' },
];

const activeHint = computed(() => tabs.find((t) => t.id === tab.value)?.hint ?? '');
</script>

<template>
  <div class="dbg">
    <header class="dbg__header">
      <h1 class="dbg__h1">Live debugger</h1>
      <span class="dbg__hint">{{ activeHint }}</span>
    </header>

    <nav class="dbg__tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="dbg__tab"
        :class="{ 'dbg__tab--active': tab === t.id }"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <KeepAlive>
      <component :is="tab === 'mal' ? DebugMal : tab === 'lal' ? DebugLal : DebugOal" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.dbg {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 18px 24px;
  gap: 12px;
}

.dbg__header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.dbg__h1 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--rr-heading);
}

.dbg__hint {
  font-size: 11.5px;
  color: var(--rr-dim);
}

.dbg__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--rr-border);
}

.dbg__tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--rr-dim);
  cursor: pointer;
}

.dbg__tab:hover {
  color: var(--rr-ink);
}

.dbg__tab--active {
  color: var(--rr-heading);
  border-bottom-color: var(--rr-active);
}
</style>
