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
 * `peerAcks` come from the install fan-out's per-peer `InstallDebugSession`
 * acks; `nodeStatuses` come from the session response's `nodes[]` array
 * (collect-time status). The two correlate by node identity (peer
 * address or nodeId).
 *
 * Wire enums (from `DSLDebuggingRestHandler.java`):
 * - install ack: INSTALLED | NOT_LOCAL | ALREADY_INSTALLED | REJECTED | FAILED.
 * - collect status: ok | captured | not_local | unreachable.
 */
import { computed } from 'vue';
import type { NodeSlice, PeerInstallAck, PriorCleanupOutcome } from '@vantage-studio/api-client';
import Pill from '../../design/primitives/Pill.vue';

const props = defineProps<{
  peerAcks: PeerInstallAck[];
  nodeStatuses: NodeSlice[];
  priorCleanup: PriorCleanupOutcome[];
}>();

interface Row {
  /** Best-effort identity — prefer nodeId, fall back to peer address. */
  key: string;
  label: string;
  install: PeerInstallAck['ack'] | null;
  collect: NodeSlice['status'] | null;
}

function rowKey(nodeId?: string, peer?: string): string {
  return nodeId && nodeId.length > 0 ? `node:${nodeId}` : `peer:${peer ?? '?'}`;
}

function rowLabel(nodeId?: string, peer?: string): string {
  return nodeId && nodeId.length > 0 ? nodeId : (peer ?? '?');
}

const rows = computed<Row[]>(() => {
  const map = new Map<string, Row>();
  for (const a of props.peerAcks) {
    const k = rowKey(a.nodeId, a.peer);
    map.set(k, {
      key: k,
      label: rowLabel(a.nodeId, a.peer),
      install: a.ack,
      collect: null,
    });
  }
  for (const n of props.nodeStatuses) {
    const k = rowKey(n.nodeId, n.peer);
    const existing = map.get(k);
    if (existing) existing.collect = n.status;
    else
      map.set(k, {
        key: k,
        label: rowLabel(n.nodeId, n.peer),
        install: null,
        collect: n.status,
      });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
});

function installTone(ack: PeerInstallAck['ack'] | null): 'ok' | 'warn' | 'err' | 'dim' {
  switch (ack) {
    case 'INSTALLED':
      return 'ok';
    case 'NOT_LOCAL':
    case 'ALREADY_INSTALLED':
      return 'dim';
    case 'REJECTED':
    case 'FAILED':
      return 'err';
    default:
      return 'dim';
  }
}

function collectTone(status: NodeSlice['status'] | null): 'ok' | 'warn' | 'err' | 'dim' {
  switch (status) {
    case 'ok':
    case 'captured':
      return 'ok';
    case 'not_local':
      return 'dim';
    case 'unreachable':
      return 'err';
    default:
      return 'dim';
  }
}

const cleanupSummary = computed<string>(() => {
  const totalStopped = props.priorCleanup.reduce(
    (n, c) => n + (c.stoppedCount ?? c.stoppedSessionIds?.length ?? 0),
    0,
  );
  if (totalStopped === 0) return '';
  const ids: string[] = [];
  for (const c of props.priorCleanup) {
    if (c.stoppedSessionIds) ids.push(...c.stoppedSessionIds);
  }
  return ids.length > 0
    ? `replaced ${totalStopped} prior session${totalStopped === 1 ? '' : 's'}: ${ids.join(', ')}`
    : `replaced ${totalStopped} prior session${totalStopped === 1 ? '' : 's'}`;
});
</script>

<template>
  <div class="cov">
    <div v-if="rows.length === 0" class="cov__empty">no peers reported</div>
    <div v-for="row in rows" :key="row.key" class="cov__row">
      <span class="cov__nodeid">{{ row.label }}</span>
      <span class="cov__pair">
        <span class="cov__label">install</span>
        <Pill :tone="installTone(row.install)">{{ row.install ?? '—' }}</Pill>
      </span>
      <span class="cov__pair">
        <span class="cov__label">collect</span>
        <Pill :tone="collectTone(row.collect)">{{ row.collect ?? '—' }}</Pill>
      </span>
    </div>
    <div v-if="cleanupSummary" class="cov__cleanup">{{ cleanupSummary }}</div>
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

.cov__cleanup {
  flex-basis: 100%;
  color: var(--rr-dim);
  font-size: 11px;
  font-family: var(--rr-font-mono);
}
</style>
