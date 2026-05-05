<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * MAL live-debugger view. Wire shape per
 * `reference_swip13_actual_wire.md` — the recorder emits MAL stage
 * names with sparse payloads (`{ samples, empty, extra }` for non-
 * terminals; `{ metric, entity, value, valueType?, timeBucket? }` for
 * meterBuild / meterEmit). No row-level sample arrays, no
 * `meterEntities[]`.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  Catalog,
  ListEnvelope,
  ListRow,
  MalMeterPayload,
  MalSamplesPayload,
  NodeSlice,
  SessionRecord,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';
import {
  isMalMeterPayload,
  isMalRecord,
  isMalSamplesPayload,
  shortHash,
} from './payload.js';

interface RuleOption {
  catalog: Catalog;
  name: string;
  contentHash: string;
}

const MAL_CATALOGS: Catalog[] = ['otel-rules', 'log-mal-rules', 'telegraf-rules'];

const dbg = useDebugSession('mal');
const selectedKey = ref<string>('');
const recordCap = ref<number>(1000);
const retentionMinutes = ref<number>(5);

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
  const s = dbg.state.value;
  return (
    selectedRule.value !== null &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
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
    // MAL upstream uses (name, ruleName) where name is the rule name
    // for runtime-rule catalogs. Pass through verbatim.
    ruleName: rule.name,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

/**
 * Pre-narrowed MAL row — one of these is computed per record once per
 * poll, so the template reads `row.samples` / `row.meter` directly
 * instead of calling type-narrowing helpers 5+ times per cell.
 *
 * At recordCap = 1000 this cuts the active-path render from ~5000
 * helper calls to 1000 once-only narrowings.
 */
interface MalRow {
  rec: SessionRecord;
  samples: MalSamplesPayload | null;
  meter: MalMeterPayload | null;
}

interface MalNodeView extends NodeSlice {
  rows: MalRow[];
}

const nodeViews = computed<MalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const rows: MalRow[] = [];
    for (const rec of n.records ?? []) {
      if (!isMalRecord(rec)) continue;
      rows.push({
        rec,
        samples: isMalSamplesPayload(rec.payload) ? rec.payload : null,
        meter: isMalMeterPayload(rec.payload) ? rec.payload : null,
      });
    }
    return { ...n, rows };
  });
});

function stageTone(stage: SessionRecord['stage']): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (stage) {
    case 'meterEmit':
      return 'active';
    case 'meterBuild':
      return 'info';
    case 'filter':
      return 'warn';
    case 'input':
      return 'ok';
    default:
      return 'dim';
  }
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
        <label class="mal__label">recordCap</label>
        <input v-model.number="recordCap" type="number" min="1" max="10000" class="mal__input" />
      </div>
      <div class="mal__field">
        <label class="mal__label">retention (min)</label>
        <input v-model.number="retentionMinutes" type="number" min="1" max="60" class="mal__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
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
      v-if="dbg.peerAcks.value.length > 0 || (dbg.session.value?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="dbg.session.value?.nodes ?? []"
      :prior-cleanup="dbg.priorCleanup.value"
    />

    <section v-if="dbg.session.value" class="mal__capture">
      <header class="mal__captureh">
        <span class="mal__sid2">session {{ dbg.session.value.sessionId }}</span>
      </header>

      <div v-for="node in nodeViews" :key="node.nodeId ?? node.peer ?? '?'" class="mal__node">
        <header class="mal__nodeh">
          <span class="mal__nodeid">{{ node.nodeId ?? node.peer ?? '?' }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : node.status === 'captured' ? 'info' : 'warn'">
            {{ node.status }}
          </Pill>
          <span v-if="node.totalBytes !== undefined" class="mal__bytes">
            {{ node.totalBytes }} bytes
          </span>
        </header>

        <div v-if="node.rows.length === 0" class="mal__nodeempty">
          no MAL records from this node
        </div>

        <table v-else class="mal__waterfall">
          <thead>
            <tr>
              <th class="mal__source">source / fragment</th>
              <th class="mal__kind">stage</th>
              <th class="mal__result">result</th>
              <th class="mal__hash">hash</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in node.rows" :key="`${node.nodeId ?? node.peer ?? '?'}-${idx}`">
              <td class="mal__source">
                <code>{{ row.rec.sourceText }}</code>
              </td>
              <td class="mal__kind">
                <Pill :tone="stageTone(row.rec.stage)">{{ row.rec.stage }}</Pill>
              </td>
              <td class="mal__result">
                <template v-if="row.samples">
                  <div class="mal__counts">
                    <span v-if="row.samples.empty">empty family</span>
                    <span v-else>samples · {{ row.samples.samples ?? 0 }}</span>
                    <span v-if="row.samples.extra?.kept !== undefined">
                      kept · {{ row.samples.extra.kept }}
                    </span>
                    <span v-if="row.samples.extra?.entities !== undefined">
                      entities · {{ row.samples.extra.entities }}
                    </span>
                  </div>
                </template>
                <template v-else-if="row.meter">
                  <div class="mal__meter">
                    <div><span class="mal__lbl">metric</span> {{ row.meter.metric }}</div>
                    <div v-if="row.meter.valueType">
                      <span class="mal__lbl">type</span> {{ row.meter.valueType }}
                    </div>
                    <div><span class="mal__lbl">entity</span> {{ row.meter.entity }}</div>
                    <div><span class="mal__lbl">value</span> {{ row.meter.value }}</div>
                    <div v-if="row.meter.timeBucket !== undefined">
                      <span class="mal__lbl">timeBucket</span> {{ row.meter.timeBucket }}
                    </div>
                  </div>
                </template>
              </td>
              <td class="mal__hash">
                <code>{{ shortHash(row.rec.contentHash) }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="mal__hint">
      pick a rule and hit start. each session captures one rule's pipeline
      stages on every cluster node simultaneously.
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

.mal__sid2 {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12px;
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

.mal__bytes {
  margin-left: auto;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
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
  width: 110px;
}

.mal__result {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  font-size: 11.5px;
}

.mal__hash {
  width: 80px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.mal__counts {
  display: flex;
  gap: 12px;
}

.mal__meter {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
}

.mal__lbl {
  display: inline-block;
  width: 90px;
  color: var(--rr-dim);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-right: 6px;
}

.mal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}
</style>
