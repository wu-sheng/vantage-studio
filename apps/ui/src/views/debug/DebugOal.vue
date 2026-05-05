<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * OAL live-debugger view. SWIP-13's actual wire is per-source-dispatcher,
 * not per-rule — picking a source captures every metric routed off it.
 *
 * Picker is fed by `/runtime/oal/rules` (one row per dispatcher, with
 * the source's full metric set). Session targets `(catalog: oal,
 * name: <source>, ruleName: <source>)` per `RuntimeOalRestHandler.java`.
 *
 * Stages emitted: `source`, `filter`, `build`, `aggregation`, `emit`.
 * `build` is what the design called `build_metrics`. No `(implicit)`
 * badge — the wire doesn't tag stages that way; just render each one
 * with its sourceText (the metric name carries through `source` /
 * `aggregation` / `emit` records as the verbatim fragment).
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  NodeSlice,
  OalMetricsPayload,
  OalRulesResponse,
  OalSourcePayload,
  SessionRecord,
  Stage,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';
import {
  isOalMetricsPayload,
  isOalRecord,
  isOalSourcePayload,
  shortHash,
} from './payload.js';

const dbg = useDebugSession('oal');
const selectedSource = ref<string>('');
const recordCap = ref<number>(1000);
const retentionMinutes = ref<number>(5);

const sourcesQuery = useQuery({
  queryKey: ['debug-oal/rules'],
  queryFn: async (): Promise<OalRulesResponse> => bff.oalSources(),
});

const sources = computed(() => sourcesQuery.data.value?.sources ?? []);

const selectedDetail = computed(() =>
  sources.value.find((s) => s.source === selectedSource.value) ?? null,
);

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedSource.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  if (!selectedSource.value) return;
  await dbg.start({
    catalog: 'oal',
    // Per upstream RuntimeOalRestHandler: name and ruleName are both
    // the source class name for OAL.
    name: selectedSource.value,
    ruleName: selectedSource.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface OalRow {
  rec: SessionRecord;
  source: OalSourcePayload | null;
  metrics: OalMetricsPayload | null;
}

interface OalRecordGroup {
  index: number;
  rows: OalRow[];
}

interface OalNodeView extends NodeSlice {
  groups: OalRecordGroup[];
}

/** Pre-shape and group in one pass per poll. Source rows delineate
 *  groups (each `source` record starts a new pipeline); within each
 *  group every record gets its payload pre-narrowed for the
 *  template. */
const nodeViews = computed<OalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const groups: OalRecordGroup[] = [];
    let cur: OalRecordGroup | null = null;
    let idx = 0;
    for (const rec of n.records ?? []) {
      if (!isOalRecord(rec)) continue;
      const row: OalRow = {
        rec,
        source: isOalSourcePayload(rec.payload) ? rec.payload : null,
        metrics: isOalMetricsPayload(rec.payload) ? rec.payload : null,
      };
      if (rec.stage === 'source' || cur === null) {
        idx += 1;
        cur = { index: idx, rows: [row] };
        groups.push(cur);
      } else {
        cur.rows.push(row);
      }
    }
    return { ...n, groups };
  });
});

function stageTone(stage: Stage): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (stage) {
    case 'emit':
      return 'active';
    case 'aggregation':
      return 'info';
    case 'build':
      return 'info';
    case 'filter':
      return 'warn';
    case 'source':
      return 'ok';
    default:
      return 'dim';
  }
}
</script>

<template>
  <div class="oal">
    <header class="oal__controls">
      <div class="oal__field">
        <label class="oal__label">source</label>
        <select v-model="selectedSource" class="oal__select" :disabled="sourcesQuery.isPending.value">
          <option value="" disabled>
            {{ sourcesQuery.isPending.value ? 'loading…' : 'select an OAL source…' }}
          </option>
          <option v-for="s in sources" :key="s.source" :value="s.source">
            {{ s.source }} · {{ s.metrics.length }} metric{{ s.metrics.length === 1 ? '' : 's' }}
          </option>
        </select>
      </div>
      <div class="oal__field">
        <label class="oal__label">recordCap</label>
        <input v-model.number="recordCap" type="number" min="1" max="10000" class="oal__input" />
      </div>
      <div class="oal__field">
        <label class="oal__label">retention (min)</label>
        <input v-model.number="retentionMinutes" type="number" min="1" max="60" class="oal__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <span class="oal__statepill">
        <Pill :tone="dbg.state.value === 'capturing' ? 'active' : dbg.state.value === 'error' ? 'err' : 'dim'">
          {{ dbg.state.value }}
        </Pill>
        <code v-if="dbg.sessionId.value" class="oal__sid">{{ dbg.sessionId.value }}</code>
      </span>
    </header>

    <p v-if="sourcesQuery.isError.value" class="oal__error">
      Could not load OAL sources.
      <button type="button" @click="sourcesQuery.refetch()">retry</button>
    </p>

    <p v-if="dbg.error.value" class="oal__error">{{ dbg.error.value }}</p>

    <div v-if="selectedDetail" class="oal__sourcecard">
      <header>
        <span class="oal__sourcekey">{{ selectedDetail.source }}</span>
        <code class="oal__dispatcher">{{ selectedDetail.dispatcher }}</code>
      </header>
      <div class="oal__metrics">
        <span v-for="m in selectedDetail.metrics" :key="m" class="oal__metric">{{ m }}</span>
      </div>
    </div>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (dbg.session.value?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="dbg.session.value?.nodes ?? []"
      :prior-cleanup="dbg.priorCleanup.value"
    />

    <section v-if="dbg.session.value" class="oal__capture">
      <header class="oal__captureh">
        <span class="oal__sid2">session {{ dbg.session.value.sessionId }}</span>
      </header>

      <div v-for="node in nodeViews" :key="node.nodeId ?? node.peer ?? '?'" class="oal__node">
        <header class="oal__nodeh">
          <span class="oal__nodeid">{{ node.nodeId ?? node.peer ?? '?' }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : node.status === 'captured' ? 'info' : 'warn'">
            {{ node.status }}
          </Pill>
          <span v-if="node.totalBytes !== undefined" class="oal__bytes">
            {{ node.totalBytes }} bytes
          </span>
        </header>

        <div v-if="node.groups.length === 0" class="oal__nodeempty">
          no source rows captured on this node
        </div>

        <div v-else class="oal__groups">
          <article
            v-for="g in node.groups"
            :key="g.index"
            class="oal__group"
          >
            <header class="oal__grouph">
              <span class="oal__groupid">source row #{{ g.index }}</span>
            </header>
            <table class="oal__waterfall">
              <thead>
                <tr>
                  <th class="oal__source">fragment</th>
                  <th class="oal__kind">stage</th>
                  <th class="oal__result">result</th>
                  <th class="oal__hash">hash</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in g.rows" :key="`${node.nodeId ?? node.peer ?? '?'}-${g.index}-${idx}`">
                  <td class="oal__source"><code>{{ row.rec.sourceText }}</code></td>
                  <td class="oal__kind">
                    <Pill :tone="stageTone(row.rec.stage)">{{ row.rec.stage }}</Pill>
                  </td>
                  <td class="oal__result">
                    <template v-if="row.source">
                      <div><span class="oal__lbl">type</span> {{ row.source.type }}</div>
                      <div v-if="row.source.scope !== undefined">
                        <span class="oal__lbl">scope</span> {{ row.source.scope }}
                      </div>
                      <div v-if="row.source.extra?.kept !== undefined">
                        <span class="oal__lbl">kept</span>
                        <Pill :tone="row.source.extra.kept ? 'ok' : 'warn'">
                          {{ row.source.extra.kept }}
                        </Pill>
                      </div>
                    </template>
                    <template v-else-if="row.metrics">
                      <div><span class="oal__lbl">type</span> {{ row.metrics.type }}</div>
                      <div>
                        <span class="oal__lbl">timeBucket</span> {{ row.metrics.timeBucket }}
                      </div>
                    </template>
                  </td>
                  <td class="oal__hash">
                    <code>{{ shortHash(row.rec.contentHash) }}</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </article>
        </div>
      </div>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="oal__hint">
      pick a source and hit start. each captured Source row produces a
      pipeline of stages — source → filter → build → aggregation → emit
      — and every metric routed off this source captures together.
    </p>
  </div>
</template>

<style scoped>
.oal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.oal__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.oal__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.oal__label {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.oal__select {
  min-width: 280px;
}

.oal__select,
.oal__input {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 4px 8px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
}

.oal__input {
  width: 90px;
}

.oal__statepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.oal__sid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__sid2 {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12px;
}

.oal__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 12px;
  margin: 0;
}

.oal__sourcecard {
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.oal__sourcecard header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.oal__sourcekey {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12.5px;
}

.oal__dispatcher {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.oal__metric {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  padding: 1px 6px;
  background: var(--rr-bg);
}

.oal__capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px;
}

.oal__captureh {
  display: flex;
  align-items: center;
  gap: 10px;
}

.oal__node {
  border: 1px solid var(--rr-border);
}

.oal__nodeh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.oal__nodeid {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-heading);
}

.oal__bytes {
  margin-left: auto;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__nodeempty {
  padding: 14px;
  font-size: 11.5px;
  color: var(--rr-dim);
  font-style: italic;
}

.oal__groups {
  display: flex;
  flex-direction: column;
}

.oal__group {
  border-bottom: 1px solid var(--rr-border);
}

.oal__group:last-child {
  border-bottom: 0;
}

.oal__grouph {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--rr-bg);
}

.oal__groupid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-heading);
}

.oal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.oal__waterfall th,
.oal__waterfall td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--rr-border);
  vertical-align: top;
}

.oal__waterfall th {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.oal__source {
  width: 280px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink);
}

.oal__source code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}

.oal__kind {
  width: 130px;
}

.oal__result {
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
}

.oal__lbl {
  display: inline-block;
  width: 90px;
  color: var(--rr-dim);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-right: 6px;
}

.oal__hash {
  width: 80px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}
</style>
