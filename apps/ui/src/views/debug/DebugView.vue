<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts" generic="N extends NodeSlice">
/**
 * Shared shell for the three live-debugger views (MAL / LAL / OAL).
 *
 * The three DSLs share most of the page: a controls header (rule
 * picker, recordCap, retentionMinutes, start/stop), a state pill +
 * sessionId display, an error strip, NodeCoverage, and a per-node
 * capture-card scaffold (header with id + status pill + totalBytes,
 * empty state, scrollable body).
 *
 * What they don't share is what goes inside each card. This component
 * provides slots for that DSL-specific content:
 *
 *   - `controls`:   the picker + cap inputs + start/stop buttons.
 *   - `subhead`:    optional sub-header strip below the controls
 *                   (e.g. selected-source card for OAL, granularity
 *                   reminder for LAL).
 *   - `idle-hint`:  the "pick a rule and hit start" hint shown when
 *                   the session is idle.
 *   - `empty`:      the per-node empty-state copy ("no LAL records
 *                   from this node"). Falls back to a generic line.
 *   - `node-body`:  the per-node body (the actual records table).
 *                   Receives `{ node }` as the slot prop.
 *
 * The shell owns the polling-state plumbing — it reads from the
 * passed-in `dbg` (a UseDebugSessionResult) and the typed
 * `nodeViews` array. Each per-DSL view is now a thin wrapper:
 * `<DebugView>` + the DSL's picker + the DSL's row renderer.
 */
import type {
  NodeSlice,
  PeerInstallAck,
  PriorCleanupOutcome,
  SessionResponse,
} from '@vantage-studio/api-client';
import type { Ref } from 'vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';

defineProps<{
  /** Composable handle. Templates read `.value` on each ref. */
  dbg: {
    state: Ref<string>;
    sessionId: Ref<string | null>;
    error: Ref<string | null>;
    session: Ref<SessionResponse | null>;
    peerAcks: Ref<PeerInstallAck[]>;
    priorCleanup: Ref<PriorCleanupOutcome[]>;
  };
  /** Per-node pre-shaped view rows. The DSL's `nodeViews` computed
   *  returns NodeSlice-derived objects; the shell only needs
   *  `nodeId`, `peer`, `status`, `totalBytes` to render the card
   *  header — actual record rendering is done by the `node-body`
   *  slot. */
  nodeViews: N[];
}>();

defineSlots<{
  controls(): unknown;
  subhead(): unknown;
  'idle-hint'(): unknown;
  empty(props: { node: N }): unknown;
  'node-body'(props: { node: N }): unknown;
}>();

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

function nodeStatusTone(status: NodeSlice['status']): 'ok' | 'info' | 'warn' | 'err' | 'dim' {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'captured':
      return 'info';
    case 'not_local':
      return 'dim';
    case 'unreachable':
      return 'err';
    default:
      return 'warn';
  }
}
</script>

<template>
  <div class="dv">
    <header class="dv__controls">
      <slot name="controls" />
      <span class="dv__statepill">
        <Pill
          :tone="dbg.state.value === 'capturing'
            ? 'active'
            : dbg.state.value === 'error'
              ? 'err'
              : 'dim'"
        >
          {{ dbg.state.value }}
        </Pill>
        <code v-if="dbg.sessionId.value" class="dv__sid">{{ dbg.sessionId.value }}</code>
      </span>
    </header>

    <slot name="subhead" />

    <p v-if="dbg.error.value" class="dv__error">{{ dbg.error.value }}</p>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (dbg.session.value?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="dbg.session.value?.nodes ?? []"
      :prior-cleanup="dbg.priorCleanup.value"
    />

    <section v-if="dbg.session.value" class="dv__capture">
      <header class="dv__captureh">
        <span class="dv__sid2">session {{ dbg.session.value.sessionId }}</span>
      </header>

      <div v-for="node in nodeViews" :key="nodeKey(node)" class="dv__node">
        <header class="dv__nodeh">
          <span class="dv__nodeid">{{ nodeKey(node) }}</span>
          <Pill :tone="nodeStatusTone(node.status)">{{ node.status }}</Pill>
          <span v-if="node.totalBytes !== undefined" class="dv__bytes">
            {{ node.totalBytes }} bytes
          </span>
        </header>
        <slot name="node-body" :node="node">
          <slot name="empty" :node="node">
            <div class="dv__nodeempty">no records from this node</div>
          </slot>
        </slot>
      </div>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="dv__hint">
      <slot name="idle-hint">
        pick a rule and hit start. each session captures one rule's
        pipeline stages on every cluster node simultaneously.
      </slot>
    </p>
  </div>
</template>

<style scoped>
.dv {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.dv__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.dv__statepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.dv__sid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.dv__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 12px;
  margin: 0;
}

.dv__capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px;
}

.dv__captureh {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dv__sid2 {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12px;
}

.dv__node {
  border: 1px solid var(--rr-border);
}

.dv__nodeh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.dv__nodeid {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-heading);
}

.dv__bytes {
  margin-left: auto;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.dv__nodeempty {
  padding: 14px;
  font-size: 11.5px;
  color: var(--rr-dim);
  font-style: italic;
}

.dv__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}
</style>
