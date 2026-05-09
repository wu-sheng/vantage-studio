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
import { decodeEntityId } from './oalEntityId.js';

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

interface OalKv {
  k: string;
  v: string;
}

/** Walk the open `fields` bag and surface every primitive value as a
 *  separate `key=value` line so the operator sees the full identity
 *  of the captured source row — not just a curated subset. Strings
 *  stay verbatim (entityId is base64); booleans / numbers stringify;
 *  nulls and nested objects are skipped to avoid noise. */
function sourceFields(p: OalSourcePayload): OalKv[] {
  const out: OalKv[] = [];
  for (const [k, v] of Object.entries(p.fields ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    out.push({ k, v: String(v) });
  }
  return out;
}

/** Decoded annotation for a field — only `entityId` carries the
 *  composite IDManager shape; everything else returns null and the
 *  template skips the parenthetical. The OAL source class
 *  (`OalSourcePayload.type`, e.g. `Service`, `Endpoint`,
 *  `ServiceRelation`) selects the right per-scope decoder. */
function decodeAnnotation(type: string, k: string, v: string): string | null {
  if (k !== 'entityId') return null;
  return decodeEntityId(type, v);
}

/** Same idea for the metrics payload — `type` is rendered out of band
 *  in the row header, but every other primitive top-level field
 *  (timeBucket, total, value, plus per-metric extras like count,
 *  summation, percentiles) becomes its own labelled line. */
function metricFields(p: OalMetricsPayload): OalKv[] {
  const out: OalKv[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === 'type') continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    out.push({ k, v: String(v) });
  }
  return out;
}

// ── Click-to-select + collaborative highlight (mirrors MAL) ────────

const selectedRow = ref<OalSampleRow | null>(null);

function selectRow(row: OalSampleRow): void {
  selectedRow.value = selectedRow.value === row ? null : row;
}

interface Segment {
  text: string;
  highlight: boolean;
}

const selectedFragment = computed<string>(
  () => selectedRow.value?.sample.sourceText.trim() ?? '',
);

/** Split a rule field into highlight / plain segments around every
 *  exact occurrence of the selected step's `sourceText`. Drives the
 *  inline `<mark>` collaborative highlight inside the captured DSL —
 *  clicking a step lights up the matching expression in the OAL
 *  statement above the chain. */
function highlightSegments(text: string | undefined, fragment: string): Segment[] {
  if (!text) return [];
  if (fragment === '') return [{ text, highlight: false }];
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = text.indexOf(fragment, cursor);
    if (at < 0) {
      segments.push({ text: text.slice(cursor), highlight: false });
      break;
    }
    if (at > cursor) segments.push({ text: text.slice(cursor, at), highlight: false });
    segments.push({ text: fragment, highlight: true });
    cursor = at + fragment.length;
  }
  return segments;
}

// ── Per-record fold state + fold/expand all (mirrors MAL) ──────────

const foldedRecords = ref<Set<string>>(new Set());

function recordFoldKey(nKey: string, idx: number): string {
  return `${nKey}#${idx}`;
}

function isRecordFolded(nKey: string, idx: number): boolean {
  return foldedRecords.value.has(recordFoldKey(nKey, idx));
}

function toggleRecord(nKey: string, idx: number): void {
  const k = recordFoldKey(nKey, idx);
  const next = new Set(foldedRecords.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  foldedRecords.value = next;
}

function foldAllRecords(): void {
  const next = new Set<string>();
  for (const v of nodeViews.value) {
    const nKey = v.nodeId ?? v.peer ?? '?';
    for (const g of v.groups) next.add(recordFoldKey(nKey, g.index));
  }
  foldedRecords.value = next;
}

function expandAllRecords(): void {
  foldedRecords.value = new Set();
}

const totalRecordCount = computed<number>(() => {
  let n = 0;
  for (const v of nodeViews.value) n += v.groups.length;
  return n;
});

const allFolded = computed<boolean>(
  () => totalRecordCount.value > 0 && foldedRecords.value.size === totalRecordCount.value,
);
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
      <div v-if="totalRecordCount > 0" class="oal__subhead">
        <span class="oal__subheadct">{{ totalRecordCount }} records · {{ foldedRecords.size }} folded</span>
        <div class="oal__subheadbtns">
          <button
            type="button"
            class="oal__subheadbtn"
            :disabled="allFolded"
            @click="foldAllRecords"
          >fold all</button>
          <button
            type="button"
            class="oal__subheadbtn"
            :disabled="foldedRecords.size === 0"
            @click="expandAllRecords"
          >expand all</button>
        </div>
      </div>
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
        <article
          v-for="g in node.groups"
          :key="g.index"
          class="oal__group"
          :class="{ 'oal__group--folded': isRecordFolded(nodeKey(node), g.index) }"
        >
          <header
            class="oal__grouph"
            @click="toggleRecord(nodeKey(node), g.index)"
          >
            <span class="oal__groupcaret">{{
              isRecordFolded(nodeKey(node), g.index) ? '▸' : '▾'
            }}</span>
            <span class="oal__groupid">source row #{{ g.index }}</span>
            <span class="oal__groupline">line {{ g.rec.rule.sourceLine ?? '—' }}</span>
            <code class="oal__rulename">{{ g.rec.rule.ruleName }}</code>
          </header>
          <template v-if="!isRecordFolded(nodeKey(node), g.index)">
            <pre v-if="g.rec.dsl" class="oal__dsl"><code><template
              v-for="(seg, si) in highlightSegments(g.rec.dsl, selectedFragment)"
              :key="si"
            ><mark
              v-if="seg.highlight"
              class="oal__hl"
            >{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></code></pre>
            <table class="oal__waterfall">
            <thead>
              <tr>
                <th class="oal__kind">step</th>
                <th class="oal__source">fragment</th>
                <th class="oal__result">payload</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, idx) in g.rows"
                :key="`${nodeKey(node)}-${g.index}-${idx}`"
                class="oal__row"
                :class="{
                  'oal__row--selected': selectedRow === row,
                  'oal__row--stopped': !row.sample.continueOn,
                }"
                @click="selectRow(row)"
              >
                <td class="oal__kind">
                  <span
                    class="oal__flow"
                    :class="{ 'oal__flow--stopped': !row.sample.continueOn }"
                    :title="row.sample.continueOn ? 'chain continues to next step' : 'chain stopped here'"
                  >{{ row.sample.continueOn ? '↓' : '⊘' }}</span>
                  <Pill :tone="sampleTone(row.sample.type)">{{ row.sample.type }}</Pill>
                </td>
                <td class="oal__source"><code>{{ row.sample.sourceText || '—' }}</code></td>
                <td class="oal__result">
                  <template v-if="row.source">
                    <div class="oal__kvline">
                      <span class="oal__lbl">type</span>
                      <span class="oal__kvval">{{ row.source.type }}</span>
                    </div>
                    <div
                      v-for="kv in sourceFields(row.source)"
                      :key="kv.k"
                      class="oal__kvline"
                    >
                      <span class="oal__lbl">{{ kv.k }}</span>
                      <span class="oal__kvval">
                        {{ kv.v }}
                        <span
                          v-if="decodeAnnotation(row.source.type, kv.k, kv.v)"
                          class="oal__decoded"
                        >({{ decodeAnnotation(row.source.type, kv.k, kv.v) }})</span>
                      </span>
                    </div>
                  </template>
                  <template v-else-if="row.metrics">
                    <div class="oal__kvline">
                      <span class="oal__lbl">type</span>
                      <span class="oal__kvval">{{ row.metrics.type }}</span>
                    </div>
                    <div
                      v-for="kv in metricFields(row.metrics)"
                      :key="kv.k"
                      class="oal__kvline"
                    >
                      <span class="oal__lbl">{{ kv.k }}</span>
                      <span class="oal__kvval">{{ kv.v }}</span>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          </template>
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
  cursor: pointer;
  user-select: none;
}

.oal__grouph:hover {
  background: var(--rr-bg2);
}

.oal__groupcaret {
  display: inline-block;
  width: 12px;
  text-align: center;
  color: var(--rr-dim);
  font-size: 11px;
}

.oal__group--folded .oal__grouph {
  border-bottom: none;
}

.oal__subhead {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.oal__subheadct {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-dim);
  letter-spacing: 0.4px;
}

.oal__subheadbtns {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.oal__subheadbtn {
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

.oal__subheadbtn:hover:not(:disabled) {
  color: var(--rr-heading);
  border-color: var(--rr-ink2);
}

.oal__subheadbtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
  font-family: var(--rr-font-mono);
  color: var(--rr-ink);
}

.oal__source code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}

.oal__kind {
  width: 150px;
  white-space: nowrap;
}

.oal__flow {
  display: inline-block;
  width: 14px;
  text-align: center;
  margin-right: 6px;
  font-family: var(--rr-font-mono);
  color: var(--rr-dim);
  font-size: 14px;
  vertical-align: middle;
  cursor: help;
}

.oal__flow--stopped {
  color: var(--rr-warn, #d6a96d);
  font-weight: 600;
}

.oal__row {
  cursor: pointer;
  transition: background-color 80ms;
}

.oal__row:hover {
  background: var(--rr-bg2);
}

.oal__row--selected,
.oal__row--selected:hover {
  background: var(--rr-bg3);
  outline: 1px solid var(--rr-accent, var(--rr-active));
  outline-offset: -1px;
}

.oal__row--stopped td {
  border-left: 2px solid var(--rr-warn, #d6a96d);
}

.oal__dsl {
  margin: 0;
  padding: 8px 12px;
  background: var(--rr-bg2);
  border-bottom: 1px solid var(--rr-border);
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-ink);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  max-height: 120px;
}

.oal__dsl code {
  font-family: var(--rr-font-mono);
  background: transparent;
  padding: 0;
}

.oal__hl {
  background: var(--rr-accent, var(--rr-active));
  color: var(--rr-bg);
  padding: 1px 2px;
}

.oal__result {
  font-family: var(--rr-font-mono);
  font-size: 15px;
  color: var(--rr-ink2);
}

.oal__kvline {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px;
  align-items: baseline;
  font-family: var(--rr-font-mono);
  font-size: 13.5px;
  line-height: 1.5;
}

.oal__lbl {
  color: var(--rr-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  white-space: nowrap;
}

.oal__kvval {
  color: var(--rr-ink);
  word-break: break-all;
}

.oal__decoded {
  color: var(--rr-dim);
  font-size: 12px;
  margin-left: 4px;
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
