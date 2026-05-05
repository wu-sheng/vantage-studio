<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * Per-cluster install / collect coverage strip rendered above each
 * debugger waterfall.
 *
 * `peerAcks` come from `POST /dsl-debugging/session`'s `peers[]`
 * field — what the receiving node heard back when it broadcast
 * `InstallDebugSession`. `nodeStatuses` come from the session
 * response's `nodes[]` array — per-peer slice availability at
 * collect time. The two are correlated by `nodeId` so the operator
 * can see "install ok but collect timed out" honestly.
 */
import { computed } from 'vue';
import type { NodeSliceBase, PeerInstallAck } from '@vantage-studio/api-client';
import Pill from '../../design/primitives/Pill.vue';

const props = defineProps<{
  peerAcks: PeerInstallAck[];
  nodeStatuses: NodeSliceBase[];
  replacedPriorIds: string[];
}>();

interface Row {
  nodeId: string;
  install: PeerInstallAck['ack'] | null;
  collect: NodeSliceBase['status'] | null;
}

const rows = computed<Row[]>(() => {
  const map = new Map<string, Row>();
  for (const a of props.peerAcks) {
    map.set(a.nodeId, { nodeId: a.nodeId, install: a.ack, collect: null });
  }
  for (const n of props.nodeStatuses) {
    const existing = map.get(n.nodeId);
    if (existing) existing.collect = n.status;
    else map.set(n.nodeId, { nodeId: n.nodeId, install: null, collect: n.status });
  }
  return [...map.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
});

function installTone(ack: PeerInstallAck['ack'] | null): 'ok' | 'warn' | 'err' | 'dim' {
  if (ack === 'ok') return 'ok';
  if (ack === 'install_failed') return 'err';
  if (ack === 'timeout') return 'warn';
  return 'dim';
}

function collectTone(status: NodeSliceBase['status'] | null): 'ok' | 'warn' | 'err' | 'dim' {
  if (status === 'ok') return 'ok';
  if (status === 'timeout' || status === 'install_failed') return 'warn';
  if (status === 'node_unreachable' || status === 'injection_disabled') return 'err';
  return 'dim';
}
</script>

<template>
  <div class="cov">
    <div v-if="rows.length === 0" class="cov__empty">no peers reported</div>
    <div v-for="row in rows" :key="row.nodeId" class="cov__row">
      <span class="cov__nodeid">{{ row.nodeId }}</span>
      <span class="cov__pair">
        <span class="cov__label">install</span>
        <Pill :tone="installTone(row.install)">{{ row.install ?? '—' }}</Pill>
      </span>
      <span class="cov__pair">
        <span class="cov__label">collect</span>
        <Pill :tone="collectTone(row.collect)">{{ row.collect ?? '—' }}</Pill>
      </span>
    </div>
    <div v-if="replacedPriorIds.length > 0" class="cov__replaced">
      replaced prior session{{ replacedPriorIds.length === 1 ? '' : 's' }}:
      <code v-for="id in replacedPriorIds" :key="id">{{ id }}</code>
    </div>
  </div>
</template>

<style scoped>
.cov {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  font-size: 11.5px;
}

.cov__empty {
  color: var(--rr-dim);
}

.cov__row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 10px 2px 0;
}

.cov__nodeid {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  min-width: 80px;
}

.cov__pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cov__label {
  color: var(--rr-dim);
  font-family: var(--rr-font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.cov__replaced {
  flex-basis: 100%;
  color: var(--rr-dim);
  font-size: 11px;
}

.cov__replaced code {
  font-family: var(--rr-font-mono);
  margin: 0 4px;
  color: var(--rr-ink2);
}
</style>
