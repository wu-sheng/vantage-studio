<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * MAL live-debugger view. Hosted in `<DebugView>`.
 *
 * The wire emits one `SessionRecord` per execution. Each record
 * carries `samples[]` whose entries discriminate via `type` (input |
 * filter | function | output for MAL). Non-output samples carry the
 * `SampleFamily.toJson()` shape (`samples`, `empty`, nested
 * `items[]`); output samples carry the materialised metric
 * (`metric`, `entity`, `valueType`, `value`, `timeBucket`).
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type {
  BundledEntry,
  Catalog,
  ListEnvelope,
  ListRow,
  MalOutputPayload,
  MalSamplesPayload,
  NodeSlice,
  SessionRecord,
  SessionSample,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import { useRuleSource } from '../../composables/useRuleSource.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import DebugView from './DebugView.vue';
import DebugSourcePane from './DebugSourcePane.vue';
import {
  isMalOutputPayload,
  isMalSamplesPayload,
  sampleTone,
  shortHash,
} from './payload.js';
import { findLineMatches } from './sourceMatch.js';

interface RuleOption {
  catalog: Catalog;
  name: string;
  contentHash: string;
}

const MAL_CATALOGS: Catalog[] = ['otel-rules', 'log-mal-rules', 'telegraf-rules'];

const route = useRoute();
const dbg = useDebugSession('mal');
/** A MAL "rule" in the catalog is a YAML **file** (rule-set) — e.g.
 *  `vm`, `mysql-exporter`. It contains many individual metrics under
 *  `metricsRules:`. The OAP debug install keys on
 *  `(catalog=<otel-rules|...>, name=<file>, ruleName=<metric>)`, so
 *  the picker has two levels: the file (selectedKey) AND a metric
 *  drilled out of the file's YAML body. */
const selectedKey = ref<string>('');
const selectedMetric = ref<string>('');
// Default 100 records / session — small enough to keep BFF + OAP
// memory bounded for casual debugging; operators can dial up to
// 10 000 (upstream's hard cap) for longer captures.
const recordCap = ref<number>(100);
const retentionMinutes = ref<number>(5);

/** Deep-link from a MAL rule card / catalog entry — `?catalog=&name=`
 *  pre-selects the file. Optional `?ruleName=` pre-fills the metric
 *  too (used by future fine-grained deep-links). */
watch(
  () => [route.query.catalog, route.query.name, route.query.ruleName] as const,
  ([c, n, r]) => {
    if (typeof c === 'string' && typeof n === 'string' && c.length > 0 && n.length > 0) {
      selectedKey.value = `${c}/${n}`;
    }
    if (typeof r === 'string' && r.length > 0) {
      selectedMetric.value = r;
    }
  },
  { immediate: true },
);

// Per-catalog picker feed: union of `/runtime/rule/list` (runtime +
// dslManager-tracked) and `/runtime/rule/bundled` (every shipped MAL
// rule). On a fresh OAP `/list` is empty for these catalogs so the
// merge is what makes the dropdown non-empty.
const listQueries = MAL_CATALOGS.map((catalog) =>
  useQuery({
    queryKey: ['debug-mal/list', catalog],
    queryFn: async (): Promise<ListEnvelope> => bff.catalogList(catalog),
  }),
);
const bundledQueries = MAL_CATALOGS.map((catalog) =>
  useQuery({
    queryKey: ['debug-mal/bundled', catalog],
    queryFn: async (): Promise<BundledEntry[]> => bff.catalogBundled(catalog, false),
  }),
);

const ruleOptions = computed<RuleOption[]>(() => {
  const seen = new Map<string, RuleOption>();
  for (let i = 0; i < MAL_CATALOGS.length; i++) {
    const catalog = MAL_CATALOGS[i]!;
    const env = listQueries[i]!.data.value;
    if (env) {
      for (const r of env.rules as ListRow[]) {
        seen.set(`${r.catalog}/${r.name}`, {
          catalog: r.catalog,
          name: r.name,
          contentHash: r.contentHash,
        });
      }
    }
    const bundled = bundledQueries[i]!.data.value;
    if (bundled) {
      for (const e of bundled) {
        const key = `${catalog}/${e.name}`;
        if (seen.has(key)) continue; // runtime row wins
        seen.set(key, { catalog, name: e.name, contentHash: e.contentHash });
      }
    }
  }
  return [...seen.values()].sort((a, b) =>
    `${a.catalog}/${a.name}`.localeCompare(`${b.catalog}/${b.name}`),
  );
});

const selectedRule = computed<RuleOption | null>(() => {
  if (!selectedKey.value) return null;
  return ruleOptions.value.find((r) => `${r.catalog}/${r.name}` === selectedKey.value) ?? null;
});

/** Fetch the selected MAL rule's YAML so we can parse the
 *  `metricsRules[].name` list and let the operator pick a metric to
 *  debug. Falls through to bundled-content automatically since the
 *  BFF's `/api/rule` proxy serves bundled fallback when no runtime
 *  row exists. */
const ruleContentQuery = useQuery({
  queryKey: computed(() => [
    'debug-mal/content',
    selectedRule.value?.catalog,
    selectedRule.value?.name,
  ]),
  queryFn: async (): Promise<string | null> => {
    const r = selectedRule.value;
    if (!r) return null;
    const got = await bff.getRule({ catalog: r.catalog, name: r.name });
    return got?.content ?? null;
  },
  enabled: computed(() => selectedRule.value !== null),
  staleTime: 30_000,
});

/** Extract metric names from the rule body. A MAL rule file is YAML
 *  with `metricsRules:` followed by a list of `- name: <metric>`
 *  entries. We regex-scan rather than fully parse YAML to keep the
 *  bundle dependency-free; the structure is rigid enough that a
 *  simple match is reliable. Comments and indentation are tolerated. */
const METRIC_NAME_RE = /^[ \t]*-[ \t]+name:[ \t]*([A-Za-z_][A-Za-z0-9_]*)/gm;
const metricNames = computed<string[]>(() => {
  const c = ruleContentQuery.data.value;
  if (!c) return [];
  const seen = new Set<string>();
  for (const m of c.matchAll(METRIC_NAME_RE)) {
    seen.add(m[1]!);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
});

/** When the file changes, clear stale metric selection (unless the
 *  new file already has a matching metric — keeps the deep-link
 *  preselect intact across the watch). */
watch(selectedRule, () => {
  if (selectedMetric.value && !metricNames.value.includes(selectedMetric.value)) {
    // wait for content load before clearing — only clear if content is
    // loaded and metric is genuinely absent
  }
});
watch(metricNames, (names) => {
  if (selectedMetric.value && !names.includes(selectedMetric.value) && names.length > 0) {
    selectedMetric.value = '';
  }
});

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedRule.value !== null &&
    selectedMetric.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  const rule = selectedRule.value;
  if (!rule || !selectedMetric.value) return;
  await dbg.start({
    catalog: rule.catalog,
    name: rule.name,
    ruleName: selectedMetric.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface MalSampleRow {
  rec: SessionRecord;
  sample: SessionSample;
  samples: MalSamplesPayload | null;
  output: MalOutputPayload | null;
}

interface MalNodeView extends NodeSlice {
  rows: MalSampleRow[];
}

const nodeViews = computed<MalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const rows: MalSampleRow[] = [];
    for (const rec of n.records ?? []) {
      for (const sample of rec.samples ?? []) {
        rows.push({
          rec,
          sample,
          samples: isMalSamplesPayload(sample.payload) ? sample.payload : null,
          output: isMalOutputPayload(sample.payload) ? sample.payload : null,
        });
      }
    }
    return { ...n, rows };
  });
});

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

/** Surface the sample-family count concisely. The MAL file-level
 *  filter probe nests `items[]` per family — recurse one level so
 *  the operator sees `2 families · 3 samples` instead of "items[]
 *  is an array". */
function summariseSamples(p: MalSamplesPayload): string {
  if (p.empty === true) return 'empty family';
  const parts: string[] = [];
  if (p.families !== undefined) parts.push(`${p.families} families`);
  if (p.samples !== undefined) parts.push(`${p.samples} samples`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

// ── Source pane plumbing ────────────────────────────────────────────

const hoveredRow = ref<MalSampleRow | null>(null);

const sourceCatalog = computed<Catalog | null>(() =>
  dbg.session.value === null ? null : selectedRule.value?.catalog ?? null,
);
const sourceName = computed<string | null>(() =>
  dbg.session.value === null ? null : selectedRule.value?.name ?? null,
);
const { source: ruleSource, query: sourceQuery } = useRuleSource({
  catalog: sourceCatalog,
  name: sourceName,
});

/** Captured DSL of the most recent record (any node) — fed into the
 *  source pane's stale detection (compares to loaded rule body). */
const pageDsl = computed<string | null>(() => {
  const s = dbg.session.value;
  if (!s) return null;
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const recs = s.nodes[i]!.records;
    if (recs && recs.length > 0) {
      return recs[recs.length - 1]!.dsl || null;
    }
  }
  return null;
});

const highlightedLines = computed<readonly number[]>(() => {
  const row = hoveredRow.value;
  const src = ruleSource.value;
  if (!row || !src) return [];
  return findLineMatches(src.content, row.sample.sourceText);
});

function refetchSource(): void {
  void sourceQuery.refetch();
}
</script>

<template>
  <DebugView :dbg="dbg" :node-views="nodeViews">
    <template #controls>
      <div class="ctl">
        <label class="ctl__lbl">rule file</label>
        <select v-model="selectedKey" class="ctl__select">
          <option value="" disabled>select a MAL rule file…</option>
          <option v-for="r in ruleOptions" :key="`${r.catalog}/${r.name}`" :value="`${r.catalog}/${r.name}`">
            {{ r.catalog }} · {{ r.name }} · {{ shortHash(r.contentHash) }}
          </option>
        </select>
      </div>
      <div class="ctl">
        <label class="ctl__lbl">metric</label>
        <select
          v-model="selectedMetric"
          class="ctl__select"
          :disabled="selectedRule === null || ruleContentQuery.isPending.value"
        >
          <option value="" disabled>
            {{ selectedRule === null
                ? 'pick a file first…'
                : ruleContentQuery.isPending.value
                  ? 'loading…'
                  : metricNames.length === 0
                    ? 'no metricsRules found in file'
                    : 'select a metric…' }}
          </option>
          <option v-for="m in metricNames" :key="m" :value="m">{{ m }}</option>
        </select>
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
        v-if="selectedRule"
        class="ctl__editlink"
        :to="{ path: '/edit', query: { catalog: selectedRule.catalog, name: selectedRule.name } }"
        :title="`open ${selectedRule.catalog} · ${selectedRule.name} in the editor`"
      >open in editor →</router-link>
    </template>

    <template #idle-hint>
      pick a rule and hit start. each captured execution shows up as a
      group of sample rows — input / filter / function / output — with
      the materialised metric on the terminal sample. the source pane
      on the right loads the rule body when you hit start; hover a row
      to highlight the matching DSL fragment.
    </template>

    <template #source-pane>
      <DebugSourcePane
        :source="ruleSource"
        :loading="sourceQuery.isPending.value"
        :error="sourceQuery.error.value === null ? null : String(sourceQuery.error.value)"
        :highlighted-lines="highlightedLines"
        :page-dsl="pageDsl"
        lang="mal"
        @refetch="refetchSource"
      />
    </template>

    <template #node-body="{ node }">
      <div v-if="node.rows.length === 0" class="mal__empty">
        no MAL samples from this node
      </div>
      <table v-else class="mal__waterfall">
        <thead>
          <tr>
            <th class="mal__source">source / fragment</th>
            <th class="mal__kind">type</th>
            <th class="mal__cont">cont</th>
            <th class="mal__result">result</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in node.rows"
            :key="`${nodeKey(node)}-${idx}`"
            class="mal__row"
            :class="{ 'mal__row--hovered': hoveredRow === row }"
            @mouseenter="hoveredRow = row"
            @mouseleave="hoveredRow = null"
          >
            <td class="mal__source">
              <code>{{ row.sample.sourceText || '—' }}</code>
            </td>
            <td class="mal__kind">
              <Pill :tone="sampleTone(row.sample.type)">{{ row.sample.type }}</Pill>
            </td>
            <td class="mal__cont">
              <Pill :tone="row.sample.continueOn ? 'ok' : 'warn'">
                {{ row.sample.continueOn ? 'cont' : 'stop' }}
              </Pill>
            </td>
            <td class="mal__result">
              <template v-if="row.output">
                <div class="mal__meter">
                  <div><span class="mal__lbl">metric</span> {{ row.output.metric }}</div>
                  <div><span class="mal__lbl">function</span> {{ row.output.valueType }}</div>
                  <div><span class="mal__lbl">entity</span> <code>{{ row.output.entity }}</code></div>
                  <div><span class="mal__lbl">timeBucket</span> {{ row.output.timeBucket }}</div>
                </div>
              </template>
              <template v-else-if="row.samples">
                <div class="mal__counts">
                  {{ summariseSamples(row.samples) }}
                </div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
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
  min-width: 320px;
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

.mal__empty {
  padding: 14px;
  font-size: 15px;
  color: var(--rr-dim);
  font-style: italic;
}

.mal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 15.5px;
}

.mal__waterfall th {
  text-align: left;
  padding: 6px 8px;
  font-family: var(--rr-font-mono);
  font-size: 13px;
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

.mal__row {
  cursor: pointer;
  transition: background-color 80ms;
}

.mal__row--hovered {
  background: var(--rr-bg3);
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

.mal__cont {
  width: 70px;
}

.mal__result {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  font-size: 15px;
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
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-right: 6px;
}
</style>
