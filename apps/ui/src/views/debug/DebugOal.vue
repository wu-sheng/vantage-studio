<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * OAL live-debugger view. Hosted in `<DebugView>`.
 *
 * Picker is fed by `/runtime/oal/rules` (per-dispatcher); session
 * targets `(oal, source, source)` per the upstream
 * RuntimeOalRestHandler.
 *
 * Each captured execution lands as one `SessionRecord` whose
 * `samples[]` walks `input → filter → function → aggregation →
 * output`. The first two samples carry the source object's columns
 * (`type` + `fields.scope`, `entityId`, …); the trailing samples
 * carry the materialised metric (`type` + `timeBucket`, `total`,
 * `value`, …).
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type {
  NodeSlice,
  OalMetricsPayload,
  OalRulesResponse,
  OalSourcePayload,
  SessionRecord,
  SessionResponse,
  SessionSample,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import { useDebugHistory, type HistoryEntry } from '../../composables/useDebugHistory.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import DebugView from './DebugView.vue';
import { isOalMetricsPayload, isOalSourcePayload, sampleTone } from './payload.js';

const route = useRoute();
const dbg = useDebugSession('oal');
const history = useDebugHistory('oal');
/** OAL session install keys: `(catalog=oal, name=<file>, ruleName=<metric>)`.
 *  The picker's two refs map directly to that wire shape. The
 *  source-listing fetched from `/runtime/oal/rules` is shown
 *  read-only as a discovery aid (which sources have live holders)
 *  but the install itself is keyed on file + metric. */
const selectedFile = ref<string>('');
const selectedMetric = ref<string>('');
// Default 100 records / session — small enough to keep BFF + OAP
// memory bounded for casual debugging; operators can dial up to
// 10 000 (upstream's hard cap) for longer captures.
const recordCap = ref<number>(100);
const retentionMinutes = ref<number>(5);

/** Deep-link from the OAL file viewer: `?file=<f>&ruleName=<metric>`
 *  pre-fills the picker so a one-click jump from a rule line lands
 *  on the right session target. */
watch(
  () => [route.query.file, route.query.ruleName] as const,
  ([f, m]) => {
    if (typeof f === 'string' && f.length > 0) selectedFile.value = f;
    if (typeof m === 'string' && m.length > 0) selectedMetric.value = m;
  },
  { immediate: true },
);

const filesQuery = useQuery({
  queryKey: ['debug-oal/files'],
  queryFn: async () => bff.oalFiles(),
});
const files = computed<string[]>(() => filesQuery.data.value?.files ?? []);

const sourcesQuery = useQuery({
  queryKey: ['debug-oal/rules'],
  queryFn: async (): Promise<OalRulesResponse> => bff.oalSources(),
});
const sources = computed(() => sourcesQuery.data.value?.sources ?? []);

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedFile.value !== '' &&
    selectedMetric.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  if (!selectedFile.value || !selectedMetric.value) return;
  await dbg.start({
    catalog: 'oal',
    name: selectedFile.value,
    ruleName: selectedMetric.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface OalSampleRow {
  sample: SessionSample;
  source: OalSourcePayload | null;
  metrics: OalMetricsPayload | null;
}

interface OalRecordGroup {
  index: number;
  rec: SessionRecord;
  rows: OalSampleRow[];
}

interface OalNodeView extends NodeSlice {
  groups: OalRecordGroup[];
}

// ── Historical replay ──────────────────────────────────────────────

const historicalEntry = shallowRef<HistoryEntry | null>(null);

const displaySession = computed<SessionResponse | null>(
  () => historicalEntry.value?.session ?? dbg.session.value,
);

function loadHistorical(entry: HistoryEntry): void {
  historicalEntry.value = entry;
  selectedFile.value = entry.name;
  selectedMetric.value = entry.ruleName;
  if (entry.recordCap !== undefined) recordCap.value = entry.recordCap;
  if (entry.retentionMillis !== undefined) {
    retentionMinutes.value = Math.max(1, Math.round(entry.retentionMillis / 60_000));
  }
}

function clearHistorical(): void {
  historicalEntry.value = null;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function persistCapture(): void {
  if (historicalEntry.value !== null) return;
  const id = dbg.sessionId.value;
  if (!id || !selectedFile.value || !selectedMetric.value) return;
  const sess: SessionResponse = dbg.session.value ?? {
    sessionId: id,
    capturedAt: Date.now(),
    nodes: [],
  };
  history.save({
    widget: 'oal',
    catalog: 'oal',
    name: selectedFile.value,
    ruleName: selectedMetric.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
    retentionDeadline: dbg.retentionDeadline.value ?? undefined,
    recordCount: sess.nodes.reduce((n, x) => n + (x.records?.length ?? 0), 0),
    nodeCount: sess.nodes.length,
    session: sess,
  });
}

watch(
  () => [dbg.sessionId.value, dbg.session.value, dbg.retentionDeadline.value] as const,
  () => persistCapture(),
);

watch(
  () => route.query.resumeSessionId,
  (id) => {
    if (typeof id !== 'string' || id === '') return;
    if (dbg.sessionId.value === id) return;
    const entry = history.entries.value.find((e) => e.session.sessionId === id);
    if (!entry) return;
    selectedFile.value = entry.name;
    selectedMetric.value = entry.ruleName;
    if (entry.recordCap !== undefined) recordCap.value = entry.recordCap;
    if (entry.retentionMillis !== undefined) {
      retentionMinutes.value = Math.max(1, Math.round(entry.retentionMillis / 60_000));
    }
    dbg.resume(id, entry.retentionDeadline ?? null);
  },
  { immediate: true },
);

watch(
  () => route.query.historyId,
  (id) => {
    if (typeof id !== 'string' || id === '') {
      if (historicalEntry.value !== null) clearHistorical();
      return;
    }
    if (historicalEntry.value?.id === id) return;
    const entry = history.entries.value.find((e) => e.id === id);
    if (entry) loadHistorical(entry);
  },
  { immediate: true },
);

const nodeViews = computed<OalNodeView[]>(() => {
  const s = displaySession.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const groups: OalRecordGroup[] = [];
    let idx = 0;
    for (const rec of n.records ?? []) {
      idx += 1;
      const rows: OalSampleRow[] = [];
      for (const sample of rec.samples ?? []) {
        rows.push({
          sample,
          source: isOalSourcePayload(sample.payload) ? sample.payload : null,
          metrics: isOalMetricsPayload(sample.payload) ? sample.payload : null,
        });
      }
      groups.push({ index: idx, rec, rows });
    }
    return { ...n, groups };
  });
});

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

/** Pull the operator-readable identity from an OAL source payload's
 *  `fields` bag. We surface entityId + the most useful per-source
 *  column (varies by source class) without baking a per-source map. */
function sourceSummary(p: OalSourcePayload): string {
  const f = p.fields ?? {};
  const parts: string[] = [];
  if (typeof f.entityId === 'string') parts.push(f.entityId);
  for (const k of ['endpoint', 'sourceServiceName', 'destServiceName', 'serviceName']) {
    const v = f[k];
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}=${v}`);
  }
  return parts.join(' · ');
}
</script>

<template>
  <DebugView
    :dbg="dbg"
    :node-views="nodeViews"
    :view-session="historicalEntry?.session ?? null"
  >
    <template #controls>
      <div class="ctl">
        <label class="ctl__lbl">file</label>
        <select v-model="selectedFile" class="ctl__select" :disabled="filesQuery.isPending.value">
          <option value="" disabled>
            {{ filesQuery.isPending.value ? 'loading…' : 'select an .oal file…' }}
          </option>
          <option v-for="f in files" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
      <div class="ctl ctl--grow">
        <label class="ctl__lbl">metric</label>
        <input
          v-model="selectedMetric"
          type="text"
          class="ctl__input ctl__input--flex"
          placeholder="e.g. service_relation_server_cpm"
        />
      </div>
      <div class="ctl">
        <label class="ctl__lbl">recordCap</label>
        <input v-model.number="recordCap" type="number" min="1" max="10000" class="ctl__input" />
      </div>
      <div class="ctl">
        <label class="ctl__lbl">retention (min)</label>
        <input v-model.number="retentionMinutes" type="number" min="1" max="60" class="ctl__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <router-link
        class="ctl__editlink"
        to="/debug/history"
        title="browse past captures saved locally"
      >history ({{ history.entries.value.length }}) →</router-link>
      <router-link
        v-if="selectedFile"
        class="ctl__editlink"
        :to="{ path: '/oal' }"
        :title="`browse the OAL files (read-only)`"
      >open in OAL catalog →</router-link>
    </template>

    <template #banner>
      <div v-if="historicalEntry" class="oal__histbanner">
        <span class="oal__histbicon">⟲</span>
        <span>
          viewing saved capture from <strong>{{ formatTime(historicalEntry.savedAt) }}</strong>
          · {{ historicalEntry.catalog }} · {{ historicalEntry.name }} · {{ historicalEntry.ruleName }}
        </span>
        <button type="button" class="oal__histback" @click="clearHistorical">back to live</button>
      </div>
    </template>

    <template #subhead>
      <p v-if="sourcesQuery.isError.value" class="oal__error">
        Could not load OAL sources reference list.
        <button type="button" @click="sourcesQuery.refetch()">retry</button>
      </p>
      <p v-if="sources.length > 0" class="oal__hint">
        OAP has
        <strong>{{ sources.length }}</strong>
        OAL source class<span v-if="sources.length !== 1">es</span> registered
        across {{ files.length }} <code>.oal</code> file<span v-if="files.length !== 1">s</span>.
        Browse them in
        <router-link to="/oal" class="oal__link">OAL catalog</router-link>
        — every <code>metric = from(Source…)</code> line has a green ▶ that
        deep-links here with the picker pre-filled.
      </p>
    </template>

    <template #idle-hint>
      pick the <code>.oal</code> file and the metric name (the LHS of
      <code>=</code> in the rule statement) and hit start. one captured
      execution = one source row entering the pipeline; samples walk
      input → filter → function → aggregation → output.
    </template>

    <template #node-body="{ node }">
      <div v-if="node.groups.length === 0" class="oal__empty">
        no source rows captured on this node
      </div>
      <div v-else class="oal__groups">
        <article v-for="g in node.groups" :key="g.index" class="oal__group">
          <header class="oal__grouph">
            <span class="oal__groupid">source row #{{ g.index }}</span>
            <span class="oal__groupline">line {{ g.rec.rule.sourceLine ?? '—' }}</span>
            <code class="oal__rulename">{{ g.rec.rule.ruleName }}</code>
          </header>
          <table class="oal__waterfall">
            <thead>
              <tr>
                <th class="oal__source">fragment</th>
                <th class="oal__kind">type</th>
                <th class="oal__cont">cont</th>
                <th class="oal__result">payload</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in g.rows" :key="`${nodeKey(node)}-${g.index}-${idx}`">
                <td class="oal__source"><code>{{ row.sample.sourceText || '—' }}</code></td>
                <td class="oal__kind">
                  <Pill :tone="sampleTone(row.sample.type)">{{ row.sample.type }}</Pill>
                </td>
                <td class="oal__cont">
                  <Pill :tone="row.sample.continueOn ? 'ok' : 'warn'">
                    {{ row.sample.continueOn ? 'cont' : 'stop' }}
                  </Pill>
                </td>
                <td class="oal__result">
                  <template v-if="row.source">
                    <div><span class="oal__lbl">type</span> {{ row.source.type }}</div>
                    <div v-if="row.source.fields.scope !== undefined">
                      <span class="oal__lbl">scope</span> {{ row.source.fields.scope }}
                    </div>
                    <div v-if="sourceSummary(row.source)" class="oal__summary">
                      <code>{{ sourceSummary(row.source) }}</code>
                    </div>
                  </template>
                  <template v-else-if="row.metrics">
                    <div><span class="oal__lbl">type</span> {{ row.metrics.type }}</div>
                    <div v-if="row.metrics.timeBucket !== undefined">
                      <span class="oal__lbl">timeBucket</span> {{ row.metrics.timeBucket }}
                    </div>
                    <div v-if="row.metrics.total !== undefined">
                      <span class="oal__lbl">total</span> {{ row.metrics.total }}
                    </div>
                    <div v-if="row.metrics.value !== undefined">
                      <span class="oal__lbl">value</span> {{ row.metrics.value }}
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </template>
  </DebugView>
</template>

<style scoped>
.ctl {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ctl__lbl {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.ctl__select {
  min-width: 280px;
}

.ctl__select,
.ctl__input {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 4px 8px;
  font-family: var(--rr-font-mono);
  font-size: 15.5px;
}

.ctl__input {
  width: 90px;
}

/* OAL metric names get long (`service_instance_response_time_percentile`,
 * `endpoint_relation_resp_time_per_min` …) — let the cell grow. */
.ctl--grow {
  flex: 1 1 280px;
  min-width: 280px;
}
.ctl__input--flex {
  width: 100%;
  min-width: 280px;
}

.oal__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 15.5px;
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
  font-size: 16px;
}

.oal__dispatcher {
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-dim);
}

.oal__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.oal__metric {
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-ink2);
  padding: 1px 6px;
  background: var(--rr-bg);
}

.oal__empty {
  padding: 14px;
  font-size: 15px;
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
  font-size: 14.5px;
  color: var(--rr-heading);
}

.oal__groupline {
  font-family: var(--rr-font-mono);
  font-size: 14px;
  color: var(--rr-dim);
}

.oal__rulename {
  margin-left: auto;
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-ink2);
}

.oal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 15.5px;
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
  font-size: 13px;
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
  width: 110px;
}

.oal__cont {
  width: 70px;
}

.oal__result {
  font-family: var(--rr-font-mono);
  font-size: 15px;
  color: var(--rr-ink2);
}

.oal__lbl {
  display: inline-block;
  width: 90px;
  color: var(--rr-dim);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-right: 6px;
}

.oal__summary {
  margin-top: 4px;
}

.oal__summary code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
  color: var(--rr-ink2);
  font-size: 14.5px;
}

.oal__sourcefallback {
  display: flex;
  flex-direction: column;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px 14px;
  font-size: 15.5px;
  color: var(--rr-ink2);
  flex: 1 1 auto;
}

.oal__sourcefallback-h {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
  margin-bottom: 8px;
}

.oal__sourcefallback p {
  margin: 0 0 8px;
}

.oal__sourcefallback code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
  color: var(--rr-ink);
}

.oal__sourcefallback-link {
  color: var(--rr-active);
  text-decoration: underline;
}

.oal__sourcefallback-hint {
  color: var(--rr-dim);
  font-style: italic;
}

.oal__histbanner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-warn, #d6a96d);
  border-left-width: 3px;
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-ink2);
}

.oal__histbicon {
  color: var(--rr-warn, #d6a96d);
  font-size: 16px;
}

.oal__histback {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--rr-border);
  color: var(--rr-ink2);
  font-family: var(--rr-font-mono);
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 3px 10px;
  cursor: pointer;
}

.oal__histback:hover {
  color: var(--rr-heading);
  border-color: var(--rr-ink2);
}
</style>
