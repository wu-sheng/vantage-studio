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
import { useRouter } from 'vue-router';
import type { ListRow } from '@vantage-studio/api-client';
import Pill from '../../design/primitives/Pill.vue';
import StatusDot from '../../design/primitives/StatusDot.vue';
import { overrideKind, formatRelativeTime } from './grouping.js';

const props = defineProps<{ rule: ListRow }>();

const router = useRouter();

const statusTone = computed(() => {
  switch (props.rule.status) {
    case 'ACTIVE':
      return 'ok' as const;
    case 'INACTIVE':
      return 'warn' as const;
    case 'BUNDLED':
      return 'dim' as const;
    case 'n/a':
      return 'err' as const;
  }
  return 'dim' as const;
});

const isSuspended = computed(() => props.rule.localState === 'SUSPENDED');

const override = computed(() => overrideKind(props.rule));

/** ACTIVE/INACTIVE rows carry updateTime + lastApplyError; bundled /
 *  orphan rows don't. The discriminated union lets us narrow safely. */
const updateLabel = computed(() => {
  if (props.rule.status === 'ACTIVE' || props.rule.status === 'INACTIVE') {
    return formatRelativeTime(props.rule.updateTime);
  }
  return null;
});

const errorMessage = computed(() => {
  if (props.rule.status === 'ACTIVE' || props.rule.status === 'INACTIVE') {
    return props.rule.lastApplyError || null;
  }
  return null;
});

const hashShort = computed(() => props.rule.contentHash.slice(0, 7) || '—');

function open(): void {
  void router.push({
    name: 'edit',
    query: { catalog: props.rule.catalog, name: props.rule.name },
  });
}
</script>

<template>
  <button
    type="button"
    class="card"
    :class="{ 'card--suspended': isSuspended, 'card--orphan': rule.status === 'n/a' }"
    :data-testid="`rule-card-${rule.name}`"
    @click="open"
  >
    <div class="card__row">
      <div class="card__name" :title="rule.name">{{ rule.name }}</div>
      <Pill :tone="statusTone">{{ rule.status }}</Pill>
    </div>

    <div class="card__row card__row--badges">
      <Pill v-if="override === 'modified'" tone="warn">modified</Pill>
      <Pill v-else-if="override === 'override'" tone="info">override</Pill>
      <Pill v-else-if="override === 'bundled-only'" tone="dim">bundled</Pill>
      <span v-if="isSuspended" class="card__suspending">
        <StatusDot tone="warn" :size="6" />
        applying…
      </span>
    </div>

    <div class="card__meta">
      <span class="card__hash">{{ hashShort }}</span>
      <span v-if="updateLabel" class="card__updated">· {{ updateLabel }}</span>
    </div>

    <p v-if="errorMessage" class="card__error" :title="errorMessage">
      {{ errorMessage }}
    </p>
  </button>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 240px;
  text-align: left;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-md);
  padding: 10px 12px;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color 0.08s ease, background 0.08s ease;
}

.card:hover {
  background: var(--rr-bg3);
  border-color: var(--rr-active);
}

.card:focus-visible {
  outline: 1px solid var(--rr-active);
  outline-offset: -1px;
  border-color: var(--rr-active);
}

.card--orphan {
  border-style: dashed;
  border-color: color-mix(in oklch, var(--rr-err) 50%, var(--rr-border));
}

.card--suspended {
  animation: cardpulse 2s ease-in-out infinite;
}

@keyframes cardpulse {
  0%,
  100% {
    border-color: var(--rr-warn);
  }
  50% {
    border-color: color-mix(in oklch, var(--rr-warn) 30%, var(--rr-border));
  }
}

.card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
}

.card__row--badges {
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-start;
}

.card__name {
  font-family: var(--rr-font-mono);
  font-size: 12.5px;
  color: var(--rr-heading);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__suspending {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-warn);
  letter-spacing: 0.4px;
}

.card__meta {
  display: flex;
  gap: 6px;
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  color: var(--rr-dim);
}

.card__hash {
  letter-spacing: 0.4px;
}

.card__error {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  color: var(--rr-err);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
