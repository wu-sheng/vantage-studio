<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * LAL live-debugger view. Hosted in `<DebugView>`.
 *
 * Each LAL record's payload is `{ sourceLine, body: { aborted,
 * hasOutput, hasParsed, extra: {...} } }`. Stages: text / parser /
 * extractor / outputRecord / outputMetric, plus `line` records when
 * granularity=statement (one per meaningful DSL statement).
 *
 * The `name` query param is the file name with extension (e.g.
 * `default.yaml`); for runtime-rule-applied LAL the upstream uses
 * the rule name directly.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  Granularity,
  LalBlockPayload,
  ListEnvelope,
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
  isLalBlockPayload,
  isLalLinePayload,
  isLalRecord,
  shortHash,
  stageTone,
} from './payload.js';
import { findLineMatches } from './sourceMatch.js';

const dbg = useDebugSession('lal');
const selectedRule = ref<string>('');
const fileName = ref<string>('');
const granularity = ref<Granularity>('block');
const recordCap = ref<number>(1000);
const retentionMinutes = ref<number>(5);

const listQuery = useQuery({
  queryKey: ['debug-lal/list'],
  queryFn: async (): Promise<ListEnvelope> => bff.catalogList('lal'),
});

const ruleNames = computed<string[]>(() => {
  const env = listQuery.data.value;
  if (!env) return [];
  return env.rules.map((r) => r.name).sort((a, b) => a.localeCompare(b));
});

function onRuleChange(): void {
  if (selectedRule.value && !fileName.value) {
    fileName.value = `${selectedRule.value}.yaml`;
  }
}

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedRule.value !== '' &&
    fileName.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  if (!selectedRule.value) return;
  await dbg.start({
    catalog: 'lal',
    name: fileName.value,
    ruleName: selectedRule.value,
    granularity: granularity.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface LalRow {
  rec: SessionRecord;
  /** Block-stage flat body. Set on text / parser / extractor /
   *  outputRecord / outputMetric records. For `line` records this
   *  pulls the wrapped body out of `payload.body` so the template
   *  renders the same fields uniformly. */
  body: LalBlockPayload | null;
  /** 1-based source line. Only set on `line` stage records (statement
   *  granularity); null for block stages. */
  sourceLine: number | null;
}

interface LalNodeView extends NodeSlice {
  rows: LalRow[];
}

const nodeViews = computed<LalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const rows: LalRow[] = [];
    for (const rec of n.records ?? []) {
      if (!isLalRecord(rec)) continue;
      if (rec.stage === 'line' && isLalLinePayload(rec.payload)) {
        rows.push({ rec, body: rec.payload.body, sourceLine: rec.payload.sourceLine });
      } else if (isLalBlockPayload(rec.payload)) {
        rows.push({ rec, body: rec.payload, sourceLine: null });
      } else {
        rows.push({ rec, body: null, sourceLine: null });
      }
    }
    return { ...n, rows };
  });
});

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

// ── Source pane plumbing ────────────────────────────────────────────

const hoveredRow = ref<LalRow | null>(null);

/** Drive the pane off `selectedRule` (the picked LAL rule). For
 *  runtime-rule-applied LAL the upstream binds the rule under the
 *  rule name in the runtime-rule list, so we use that as `name`. */
const sourceCatalog = computed<'lal' | null>(() =>
  dbg.session.value === null || !selectedRule.value ? null : 'lal',
);
const sourceName = computed<string | null>(() =>
  dbg.session.value === null ? null : selectedRule.value || null,
);
const { source: ruleSource, query: sourceQuery } = useRuleSource({
  catalog: sourceCatalog,
  name: sourceName,
});

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

/** LAL highlights:
 *  - `line` stage records: exact match via `row.sourceLine`.
 *  - block stages: pseudo-fragments (`raw`/`parsed`/`fields`/output
 *    class) don't appear in the source as-is; skip highlighting.
 */
const highlightedLines = computed<readonly number[]>(() => {
  const row = hoveredRow.value;
  const src = ruleSource.value;
  if (!row || !src) return [];
  if (row.sourceLine !== null) return [row.sourceLine];
  // `outputRecord` extras carry the typed-output class name (e.g.
  // `LogBuilder`); search for it in the body so the operator can see
  // which YAML key configures the output.
  if (row.body?.extra?.outputClass) {
    return findLineMatches(src.content, row.body.extra.outputClass);
  }
  return [];
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
        <select v-model="selectedRule" class="ctl__select" @change="onRuleChange">
          <option value="" disabled>select a LAL rule…</option>
          <option v-for="n in ruleNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="ctl">
        <label class="ctl__lbl">file (with extension)</label>
        <input v-model="fileName" type="text" class="ctl__input ctl__input--wide" placeholder="default.yaml" />
      </div>
      <div class="ctl">
        <label class="ctl__lbl">granularity</label>
        <div class="lal__granularity">
          <button
            type="button"
            class="lal__granbtn"
            :class="{ 'lal__granbtn--active': granularity === 'block' }"
            @click="granularity = 'block'"
          >block</button>
          <button
            type="button"
            class="lal__granbtn"
            :class="{ 'lal__granbtn--active': granularity === 'statement' }"
            @click="granularity = 'statement'"
          >statement</button>
        </div>
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
      pick a LAL rule, set the file (typically <code>{ruleName}.yaml</code>),
      hit start. each captured log record fills one row per probed stage —
      the upstream emits text → parser → extractor → outputRecord /
      outputMetric for kept records. Statement granularity adds one
      <code>line</code> row per DSL statement. the source pane on the
      right loads the rule body when you hit start; hover a row to
      highlight the matching DSL line.
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
      <div v-if="node.rows.length === 0" class="lal__empty">
        no LAL records from this node
      </div>
      <table v-else class="lal__waterfall">
        <thead>
          <tr>
            <th class="lal__line">ln</th>
            <th class="lal__source">source</th>
            <th class="lal__kind">stage</th>
            <th class="lal__result">body summary</th>
            <th class="lal__extra">extra</th>
            <th class="lal__hash">hash</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, idx) in node.rows"
            :key="`${nodeKey(node)}-${idx}`"
            class="lal__row"
            :class="{ 'lal__row--hovered': hoveredRow === row }"
            @mouseenter="hoveredRow = row"
            @mouseleave="hoveredRow = null"
          >
            <td class="lal__line">{{ row.sourceLine ?? '—' }}</td>
            <td class="lal__source"><code>{{ row.rec.sourceText }}</code></td>
            <td class="lal__kind">
              <Pill :tone="stageTone(row.rec.stage)">{{ row.rec.stage }}</Pill>
            </td>
            <td class="lal__result">
              <template v-if="row.body">
                <div class="lal__flags">
                  <span v-if="row.body.aborted" class="lal__flag lal__flag--warn">aborted</span>
                  <span v-if="row.body.hasOutput" class="lal__flag lal__flag--ok">hasOutput</span>
                  <span v-if="row.body.hasParsed" class="lal__flag lal__flag--ok">hasParsed</span>
                </div>
              </template>
            </td>
            <td class="lal__extra">
              <template v-if="row.body?.extra">
                <div v-if="row.body.extra.outputClass" class="lal__extraitem">
                  <span class="lal__lbl">class</span>
                  <code>{{ row.body.extra.outputClass }}</code>
                </div>
                <div v-if="row.body.extra.samples !== undefined" class="lal__extraitem">
                  <span class="lal__lbl">samples</span>
                  {{ row.body.extra.samples }}
                </div>
              </template>
            </td>
            <td class="lal__hash">
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
  min-width: 240px;
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

.ctl__input--wide {
  width: 200px;
}

.lal__granularity {
  display: inline-flex;
  border: 1px solid var(--rr-border);
  background: var(--rr-bg2);
}

.lal__granbtn {
  background: transparent;
  border: 0;
  color: var(--rr-ink2);
  padding: 4px 10px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  cursor: pointer;
}

.lal__granbtn--active {
  background: var(--rr-bg3);
  color: var(--rr-heading);
}

.lal__granbtn:not(.lal__granbtn--active):hover {
  background: var(--rr-bg3);
}

.lal__empty {
  padding: 14px;
  font-size: 11.5px;
  color: var(--rr-dim);
  font-style: italic;
}

.lal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.lal__waterfall th,
.lal__waterfall td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--rr-border);
  vertical-align: top;
}

.lal__row {
  cursor: pointer;
  transition: background-color 80ms;
}

.lal__row--hovered {
  background: var(--rr-bg3);
}

.lal__waterfall th {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.lal__line {
  width: 36px;
  font-family: var(--rr-font-mono);
  color: var(--rr-dim);
}

.lal__source {
  width: 140px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
}

.lal__source code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}

.lal__kind {
  width: 130px;
}

.lal__result {
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
}

.lal__flags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.lal__flag {
  display: inline-block;
  padding: 1px 6px;
  background: var(--rr-bg);
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-ink2);
}

.lal__flag--ok {
  color: var(--rr-ok, #5fa56f);
}

.lal__flag--warn {
  color: var(--rr-warn, #d4a93b);
}

.lal__extra {
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
}

.lal__extraitem {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lal__lbl {
  color: var(--rr-dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  min-width: 60px;
}

.lal__hash {
  width: 80px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}
</style>
