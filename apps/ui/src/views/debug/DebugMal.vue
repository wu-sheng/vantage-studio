<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * MAL live-debugger view — SWIP-13 §1 MAL section + §7 design.
 *
 * Layout:
 *   - rule picker (catalog + name) fed from /runtime/rule/list
 *     across MAL catalogs (otel-rules + log-mal-rules).
 *   - capture controls: maxRecords, windowSec, Start / Stop.
 *   - cluster coverage strip + replaced-prior-id badge.
 *   - per-node waterfall with the 8 stage kinds; each row pairs
 *     `sourceText` (left, line gutter) with the result snapshot
 *     (right) — labels/value table for samples, populated
 *     `meterEntities[]` at terminal stages.
 *   - rule-snapshots disclosure showing the YAML for every
 *     contentHash the session encountered (handles hot-update mid-
 *     session honestly).
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  Catalog,
  ListEnvelope,
  ListRow,
  MalNodeSlice,
  MalStageRecord,
  MeterEntitySnapshot,
  RuleSnapshot,
  SampleSnapshot,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';
import { splitTruncation } from './truncation.js';

interface RuleOption {
  catalog: Catalog;
  name: string;
  contentHash: string;
}

const MAL_CATALOGS: Catalog[] = ['otel-rules', 'log-mal-rules'];

const dbg = useDebugSession('mal');
const selectedKey = ref<string>(''); // `${catalog}/${name}`
const maxRecords = ref<number>(100);
const windowSec = ref<number>(60);

const listQueries = MAL_CATALOGS.map((catalog) =>
  useQuery({
    queryKey: ['debug-mal/list', catalog],
    queryFn: async (): Promise<ListEnvelope> => bff.catalogList(catalog),
  }),
);

const ruleOptions = computed<RuleOption[]>(() => {
  const out: RuleOption[] = [];
  for (let i = 0; i < listQueries.length; i++) {
    const env = listQueries[i]!.data.value;
    if (!env) continue;
    for (const r of env.rules as ListRow[]) {
      out.push({ catalog: r.catalog, name: r.name, contentHash: r.contentHash });
    }
  }
  out.sort((a, b) => `${a.catalog}/${a.name}`.localeCompare(`${b.catalog}/${b.name}`));
  return out;
});

const selectedRule = computed<RuleOption | null>(() => {
  if (!selectedKey.value) return null;
  return ruleOptions.value.find((r) => `${r.catalog}/${r.name}` === selectedKey.value) ?? null;
});

const startEnabled = computed(() => {
  return (
    selectedRule.value !== null &&
    (dbg.state.value === 'idle' ||
      dbg.state.value === 'captured' ||
      dbg.state.value === 'expired' ||
      dbg.state.value === 'stopped' ||
      dbg.state.value === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  const rule = selectedRule.value;
  if (!rule) return;
  await dbg.start({
    catalog: rule.catalog,
    name: rule.name,
    maxRecords: maxRecords.value,
    windowSec: windowSec.value,
  });
}

const malSession = computed(() => {
  const s = dbg.session.value;
  if (s && (s.catalog === 'otel-rules' || s.catalog === 'log-mal-rules')) return s;
  return null;
});

function stageTone(kind: MalStageRecord['kind']): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (kind) {
    case 'meter_emit':
      return 'active';
    case 'meter_build':
      return 'info';
    case 'filter':
      return 'warn';
    default:
      return 'dim';
  }
}

function describeSample(s: SampleSnapshot): string {
  if (typeof s !== 'object' || s === null) return String(s);
  const labelStr =
    s.labels && Object.keys(s.labels).length > 0
      ? Object.entries(s.labels)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
      : '';
  const valueStr = s.value !== undefined ? `→ ${String(s.value)}` : '';
  if (labelStr || valueStr) return [labelStr, valueStr].filter(Boolean).join(' ');
  return JSON.stringify(s);
}

function describeEntity(e: MeterEntitySnapshot): string {
  const id = e.entityId ?? e.name ?? '?';
  const scope = e.scopeType ? `[${e.scopeType}]` : '';
  const layer = e.layer ? ` ${e.layer}` : '';
  const value = e.value !== undefined ? ` → ${formatValue(e.value)}` : '';
  return `${id}${scope}${layer}${value}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ruleSnapshotEntries = computed<[string, RuleSnapshot][]>(() => {
  const s = malSession.value;
  if (!s) return [];
  return Object.entries(s.ruleSnapshots ?? {});
});

function shortHash(h: string): string {
  return h ? h.slice(0, 8) : '—';
}
</script>

<template>
  <div class="mal">
    <header class="mal__controls">
      <div class="mal__field">
        <label class="mal__label">rule</label>
        <select v-model="selectedKey" class="mal__select">
          <option value="" disabled>select a MAL rule…</option>
          <option v-for="r in ruleOptions" :key="`${r.catalog}/${r.name}`" :value="`${r.catalog}/${r.name}`">
            {{ r.catalog }} · {{ r.name }} · {{ shortHash(r.contentHash) }}
          </option>
        </select>
      </div>
      <div class="mal__field">
        <label class="mal__label">maxRecords</label>
        <input v-model.number="maxRecords" type="number" min="1" max="500" class="mal__input" />
      </div>
      <div class="mal__field">
        <label class="mal__label">windowSec</label>
        <input v-model.number="windowSec" type="number" min="1" max="600" class="mal__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">
        start sampling
      </Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <span class="mal__statepill">
        <Pill :tone="dbg.state.value === 'capturing' ? 'active' : dbg.state.value === 'error' ? 'err' : 'dim'">
          {{ dbg.state.value }}
        </Pill>
        <code v-if="dbg.sessionId.value" class="mal__sid">{{ dbg.sessionId.value }}</code>
      </span>
    </header>

    <p v-if="dbg.error.value" class="mal__error">{{ dbg.error.value }}</p>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (malSession?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="malSession?.nodes ?? []"
      :replaced-prior-ids="dbg.replacedPriorIds.value"
    />

    <section v-if="malSession" class="mal__capture">
      <header class="mal__captureh">
        <span class="mal__rulename">
          {{ malSession.catalog }} · {{ malSession.name }}
        </span>
        <Pill v-if="malSession.reason" :tone="malSession.reason === 'manual_stop' ? 'dim' : 'info'">
          {{ malSession.reason }}
        </Pill>
      </header>

      <div v-for="node in malSession.nodes" :key="node.nodeId" class="mal__node">
        <header class="mal__nodeh">
          <span class="mal__nodeid">{{ node.nodeId }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : 'warn'">{{ node.status }}</Pill>
        </header>
        <div v-if="!node.records || node.records.length === 0" class="mal__nodeempty">
          no captures from this node
        </div>
        <table v-else class="mal__waterfall">
          <thead>
            <tr>
              <th class="mal__line">ln</th>
              <th class="mal__source">source</th>
              <th class="mal__kind">stage</th>
              <th class="mal__result">result</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rec, idx) in node.records" :key="`${rec.id}-${idx}`">
              <td class="mal__line">{{ rec.sourceLine ?? '—' }}</td>
              <td class="mal__source">
                <code v-if="rec.sourceText">{{ rec.sourceText }}</code>
                <span v-else class="mal__implicit">(implicit)</span>
              </td>
              <td class="mal__kind">
                <Pill :tone="stageTone(rec.kind)">{{ rec.kind }}</Pill>
                <code v-if="rec.contentHash" class="mal__hash">{{ shortHash(rec.contentHash) }}</code>
              </td>
              <td class="mal__result">
                <div v-if="rec.kind === 'downsampling'" class="mal__downsamp">
                  {{ rec.downsampling?.function ?? '?' }}
                  <Pill v-if="rec.downsampling?.origin === 'default'" tone="dim">default</Pill>
                </div>

                <div
                  v-if="rec.inCount !== undefined || rec.outCount !== undefined || rec.dropped !== undefined"
                  class="mal__counts"
                >
                  <span v-if="rec.inCount !== undefined">in {{ rec.inCount }}</span>
                  <span v-if="rec.outCount !== undefined">out {{ rec.outCount }}</span>
                  <span v-if="rec.dropped">dropped {{ rec.dropped }}</span>
                </div>

                <template v-if="rec.samples">
                  <ul class="mal__samples">
                    <li
                      v-for="(s, i) in splitTruncation(rec.samples).entries"
                      :key="i"
                      class="mal__sample"
                    >
                      {{ describeSample(s) }}
                    </li>
                  </ul>
                  <div v-if="splitTruncation(rec.samples).truncation" class="mal__more">
                    {{ splitTruncation(rec.samples).truncation }}
                  </div>
                </template>

                <div v-if="rec.meterValueType" class="mal__valuetype">
                  type · <code>{{ rec.meterValueType }}</code>
                </div>

                <template v-if="rec.meterEntities">
                  <ul class="mal__entities">
                    <li
                      v-for="(e, i) in splitTruncation(rec.meterEntities).entries"
                      :key="i"
                      class="mal__entity"
                    >
                      {{ describeEntity(e) }}
                    </li>
                  </ul>
                  <div v-if="splitTruncation(rec.meterEntities).truncation" class="mal__more">
                    {{ splitTruncation(rec.meterEntities).truncation }}
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details v-if="ruleSnapshotEntries.length > 0" class="mal__snapshots">
        <summary>
          {{ ruleSnapshotEntries.length }} rule snapshot{{ ruleSnapshotEntries.length === 1 ? '' : 's' }}
        </summary>
        <div v-for="[hash, snap] in ruleSnapshotEntries" :key="hash" class="mal__snapshot">
          <header>
            <code>{{ shortHash(hash) }}</code>
            <span v-if="snap.capturedFirstAt" class="mal__snapwhen">
              first seen {{ new Date(snap.capturedFirstAt).toISOString() }}
            </span>
          </header>
          <pre class="mal__snappre">{{ snap.content }}</pre>
        </div>
      </details>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="mal__hint">
      pick a rule and hit start. each session captures one rule's
      pipeline stages on every cluster node simultaneously.
    </p>
  </div>
</template>

<style scoped>
.mal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.mal__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.mal__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mal__label {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.mal__select {
  min-width: 320px;
}

.mal__select,
.mal__input {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 4px 8px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
}

.mal__input {
  width: 90px;
}

.mal__statepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.mal__sid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.mal__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 12px;
  margin: 0;
}

.mal__capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px;
}

.mal__captureh {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mal__rulename {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 13px;
}

.mal__node {
  border: 1px solid var(--rr-border);
}

.mal__nodeh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.mal__nodeid {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-heading);
}

.mal__nodeempty {
  padding: 14px;
  font-size: 11.5px;
  color: var(--rr-dim);
  font-style: italic;
}

.mal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.mal__waterfall th {
  text-align: left;
  padding: 6px 8px;
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
}

.mal__waterfall td {
  padding: 6px 8px;
  vertical-align: top;
  border-bottom: 1px solid var(--rr-border);
}

.mal__line {
  width: 36px;
  font-family: var(--rr-font-mono);
  color: var(--rr-dim);
}

.mal__source {
  width: 320px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink);
}

.mal__source code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}

.mal__kind {
  width: 130px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mal__hash {
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-dim);
}

.mal__implicit {
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11.5px;
}

.mal__counts {
  display: flex;
  gap: 10px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.mal__samples,
.mal__entities {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.mal__sample,
.mal__entity {
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
  padding: 1px 0;
}

.mal__valuetype {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
  margin-top: 4px;
}

.mal__valuetype code {
  color: var(--rr-ink2);
}

.mal__more {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-warn, #d4a93b);
  margin-top: 2px;
}

.mal__downsamp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-ink);
}

.mal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}

.mal__snapshots {
  border-top: 1px solid var(--rr-border);
  padding-top: 8px;
}

.mal__snapshots summary {
  cursor: pointer;
  color: var(--rr-dim);
  font-size: 11.5px;
}

.mal__snapshot {
  margin-top: 8px;
}

.mal__snapshot header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--rr-dim);
}

.mal__snapwhen {
  font-style: italic;
}

.mal__snappre {
  margin: 4px 0 0;
  padding: 8px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  color: var(--rr-ink2);
}
</style>
