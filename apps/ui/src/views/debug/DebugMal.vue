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
 *
 * Hosted in `<DebugView>` — this file owns only the picker, the
 * MAL-specific row narrowing, and the per-row table renderer.
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
import { useRuleSource } from '../../composables/useRuleSource.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import DebugView from './DebugView.vue';
import DebugSourcePane from './DebugSourcePane.vue';
import {
  isMalMeterPayload,
  isMalRecord,
  isMalSamplesPayload,
  shortHash,
  stageTone,
} from './payload.js';
import { findLineMatches } from './sourceMatch.js';

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
    ruleName: rule.name,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

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

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

// ── Source pane plumbing ────────────────────────────────────────────

const hoveredRow = ref<MalRow | null>(null);

/** When a session is active, drive the source pane off the rule the
 *  session bound to (selectedRule won't change post-start). */
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

/** SHA-256 of the most recent captured record (any node) — drives the
 *  stale-source banner if a hot-update fires mid-session. */
const pageHash = computed<string | null>(() => {
  const s = dbg.session.value;
  if (!s) return null;
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const recs = s.nodes[i]!.records;
    if (recs && recs.length > 0) {
      return recs[recs.length - 1]!.contentHash || null;
    }
  }
  return null;
});

const highlightedLines = computed<readonly number[]>(() => {
  const row = hoveredRow.value;
  const src = ruleSource.value;
  if (!row || !src) return [];
  return findLineMatches(src.content, row.rec.sourceText);
});

function refetchSource(): void {
  void sourceQuery.refetch();
}
</script>

<template>
  <DebugView :dbg="dbg" :node-views="nodeViews">
    <template #controls>
      <div class="ctl">
        <label class="ctl__lbl">rule</label>
        <select v-model="selectedKey" class="ctl__select">
          <option value="" disabled>select a MAL rule…</option>
          <option v-for="r in ruleOptions" :key="`${r.catalog}/${r.name}`" :value="`${r.catalog}/${r.name}`">
            {{ r.catalog }} · {{ r.name }} · {{ shortHash(r.contentHash) }}
          </option>
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
    </template>

    <template #idle-hint>
      pick a rule and hit start. each session captures one rule's pipeline
      stages on every cluster node simultaneously. the source pane on the
      right will load the rule body when you hit start; hover a row to
      highlight the matching DSL fragment.
    </template>

    <template #source-pane>
      <DebugSourcePane
        :source="ruleSource"
        :loading="sourceQuery.isPending.value"
        :error="sourceQuery.error.value === null ? null : String(sourceQuery.error.value)"
        :highlighted-lines="highlightedLines"
        :page-hash="pageHash"
        @refetch="refetchSource"
      />
    </template>

    <template #node-body="{ node }">
      <div v-if="node.rows.length === 0" class="mal__empty">
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
          <tr
            v-for="(row, idx) in node.rows"
            :key="`${nodeKey(node)}-${idx}`"
            class="mal__row"
            :class="{ 'mal__row--hovered': hoveredRow === row }"
            @mouseenter="hoveredRow = row"
            @mouseleave="hoveredRow = null"
          >
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
  font-size: 9.5px;
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
  font-size: 12px;
}

.ctl__input {
  width: 90px;
}

.mal__empty {
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
</style>
