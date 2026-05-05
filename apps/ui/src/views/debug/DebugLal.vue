<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * LAL live-debugger view — SWIP-13 §1 LAL section + §7 design.
 *
 * Layout:
 *   - rule picker fed from /runtime/rule/list?catalog=lal.
 *   - granularity toggle: block (default) | statement.
 *   - per-block sampling toggle (6 blocks; default all on).
 *   - capture controls: maxRecords, windowSec, Start/Stop.
 *   - cluster coverage strip.
 *   - records-as-columns × blocks-as-rows grid: each captured log
 *     record fills one column; rows are the 5 fixed blocks plus
 *     output_record + output_metric. In statement granularity the
 *     extractor block expands into per-line cells.
 *   - rule snapshots disclosure for cross-hot-update content.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  LalBlock,
  LalNodeSlice,
  LalRecord,
  ListEnvelope,
  RuleSnapshot,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';

const ALL_BLOCKS: LalBlock[] = [
  'text',
  'parser',
  'extractor',
  'sink',
  'output_record',
  'output_metric',
];

const dbg = useDebugSession('lal');
const selectedName = ref<string>('');
const granularity = ref<'block' | 'statement'>('block');
const blocks = ref<Record<LalBlock, boolean>>({
  text: true,
  parser: true,
  extractor: true,
  sink: true,
  output_record: true,
  output_metric: true,
});
const maxRecords = ref<number>(8);
const windowSec = ref<number>(60);

const listQuery = useQuery({
  queryKey: ['debug-lal/list'],
  queryFn: async (): Promise<ListEnvelope> => bff.catalogList('lal'),
});

const ruleNames = computed<string[]>(() => {
  const env = listQuery.data.value;
  if (!env) return [];
  return env.rules.map((r) => r.name).sort((a, b) => a.localeCompare(b));
});

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedName.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'expired' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  if (!selectedName.value) return;
  const enabledBlocks = ALL_BLOCKS.filter((b) => blocks.value[b]);
  // Don't pass `blocks` when every block is on — server default
  // captures all of them, and SWIP §1 specifies the default is "all
  // 5 fixed blocks + 2 output emit points".
  const blocksArg = enabledBlocks.length === ALL_BLOCKS.length ? undefined : enabledBlocks;
  await dbg.start({
    catalog: 'lal',
    name: selectedName.value,
    maxRecords: maxRecords.value,
    windowSec: windowSec.value,
    granularity: granularity.value,
    ...(blocksArg !== undefined ? { blocks: blocksArg } : {}),
  });
}

const lalSession = computed(() => {
  const s = dbg.session.value;
  return s && s.catalog === 'lal' ? s : null;
});

interface RowSpec {
  key: string;
  label: string;
  kind: 'block' | 'statement';
  block?: LalBlock;
  /** When kind === 'statement', the source line. */
  sourceLine?: number;
}

/** Build the row spec for the grid. In block mode it's the 6 fixed
 *  blocks. In statement mode we also splice in one row per unique
 *  (sourceLine) seen across statement-level records, sorted by
 *  line. */
function buildRows(records: LalRecord[]): RowSpec[] {
  const rows: RowSpec[] = ALL_BLOCKS.map((b) => ({
    key: `block:${b}`,
    label: b,
    kind: 'block',
    block: b,
  }));
  if (granularity.value === 'statement') {
    const lines = new Set<number>();
    for (const r of records) {
      if (typeof r.sourceLine === 'number') lines.add(r.sourceLine);
    }
    const sortedLines = [...lines].sort((a, b) => a - b);
    // Insert statement rows after the extractor block — that's the
    // most common statement-level capture site per SWIP §1.
    const extractorIdx = rows.findIndex((r) => r.block === 'extractor');
    const insertAt = extractorIdx + 1;
    const stmtRows: RowSpec[] = sortedLines.map((ln) => ({
      key: `stmt:${ln}`,
      label: `line ${ln}`,
      kind: 'statement',
      sourceLine: ln,
    }));
    rows.splice(insertAt, 0, ...stmtRows);
  }
  return rows;
}

/** The cell value to render for a given row × record. */
function cellFor(row: RowSpec, rec: LalRecord): unknown {
  if (row.kind === 'statement') {
    return rec.sourceLine === row.sourceLine ? rec : null;
  }
  switch (row.block) {
    case 'text':
      return rec.text === undefined && rec.body_type === undefined
        ? null
        : { text: rec.text, body_type: rec.body_type };
    case 'parser':
      return rec.parsed ?? null;
    case 'extractor':
      return rec.extracted || rec.def_vars
        ? { extracted: rec.extracted, def_vars: rec.def_vars }
        : null;
    case 'sink':
      return rec.sink ?? null;
    case 'output_record':
      return rec.output_record ?? null;
    case 'output_metric':
      return rec.output_metric ?? null;
  }
  return null;
}

function describeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function sinkTone(rec: LalRecord): 'ok' | 'warn' | 'err' | 'dim' {
  if (!rec.sink) return 'dim';
  if (rec.sink.kept === true) return 'ok';
  if (rec.sink.kept === false) return 'warn';
  return 'dim';
}

const ruleSnapshotEntries = computed<[string, RuleSnapshot][]>(() => {
  const s = lalSession.value;
  if (!s) return [];
  return Object.entries(s.ruleSnapshots ?? {});
});

function shortHash(h: string): string {
  return h ? h.slice(0, 8) : '—';
}

function nodeRows(node: LalNodeSlice): { rows: RowSpec[]; records: LalRecord[] } {
  const records = node.records ?? [];
  return { rows: buildRows(records), records };
}
</script>

<template>
  <div class="lal">
    <header class="lal__controls">
      <div class="lal__field">
        <label class="lal__label">rule</label>
        <select v-model="selectedName" class="lal__select">
          <option value="" disabled>select a LAL rule…</option>
          <option v-for="n in ruleNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="lal__field">
        <label class="lal__label">granularity</label>
        <div class="lal__toggle">
          <button
            type="button"
            class="lal__pill"
            :class="{ 'lal__pill--active': granularity === 'block' }"
            @click="granularity = 'block'"
          >block</button>
          <button
            type="button"
            class="lal__pill"
            :class="{ 'lal__pill--active': granularity === 'statement' }"
            @click="granularity = 'statement'"
          >statement</button>
        </div>
      </div>
      <div class="lal__field">
        <label class="lal__label">blocks</label>
        <div class="lal__blocks">
          <label v-for="b in ALL_BLOCKS" :key="b" class="lal__blockcheck">
            <input type="checkbox" v-model="blocks[b]" />
            <span>{{ b }}</span>
          </label>
        </div>
      </div>
      <div class="lal__field">
        <label class="lal__label">maxRecords</label>
        <input v-model.number="maxRecords" type="number" min="1" max="100" class="lal__input" />
      </div>
      <div class="lal__field">
        <label class="lal__label">windowSec</label>
        <input v-model.number="windowSec" type="number" min="1" max="600" class="lal__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <span class="lal__statepill">
        <Pill :tone="dbg.state.value === 'capturing' ? 'active' : dbg.state.value === 'error' ? 'err' : 'dim'">
          {{ dbg.state.value }}
        </Pill>
        <code v-if="dbg.sessionId.value" class="lal__sid">{{ dbg.sessionId.value }}</code>
      </span>
    </header>

    <p v-if="granularity === 'statement'" class="lal__warn">
      statement granularity captures one cell per meaningful DSL line —
      a 12-statement extractor produces ~19 cells per record vs. 7 in
      block mode. Drop maxRecords to ~3 to stay inside the per-session
      byte cap.
    </p>

    <p v-if="dbg.error.value" class="lal__error">{{ dbg.error.value }}</p>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (lalSession?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="lalSession?.nodes ?? []"
      :replaced-prior-ids="dbg.replacedPriorIds.value"
    />

    <section v-if="lalSession" class="lal__capture">
      <header class="lal__captureh">
        <span class="lal__rulename">lal · {{ lalSession.name }}</span>
        <Pill v-if="lalSession.granularity" tone="info">{{ lalSession.granularity }}</Pill>
        <Pill v-if="lalSession.reason" :tone="lalSession.reason === 'manual_stop' ? 'dim' : 'info'">
          {{ lalSession.reason }}
        </Pill>
      </header>

      <div v-for="node in lalSession.nodes" :key="node.nodeId" class="lal__node">
        <header class="lal__nodeh">
          <span class="lal__nodeid">{{ node.nodeId }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : 'warn'">{{ node.status }}</Pill>
        </header>

        <div v-if="!node.records || node.records.length === 0" class="lal__nodeempty">
          no log records captured on this node
        </div>

        <div v-else class="lal__gridwrap">
          <table class="lal__grid">
            <thead>
              <tr>
                <th class="lal__rowlabel">block</th>
                <th
                  v-for="(rec, idx) in node.records"
                  :key="rec.id"
                  class="lal__reccol"
                >
                  <div class="lal__rechead">
                    <span class="lal__recid">#{{ idx + 1 }}</span>
                    <span v-if="rec.svc" class="lal__recsvc">{{ rec.svc }}</span>
                    <span v-if="rec.ts" class="lal__rects">{{ new Date(rec.ts).toLocaleTimeString() }}</span>
                  </div>
                  <div v-if="rec.sink" class="lal__recsink">
                    <Pill :tone="sinkTone(rec)">{{ rec.sink.branch ?? 'sink' }} · {{ rec.sink.kept ? 'kept' : 'dropped' }}</Pill>
                  </div>
                  <code v-if="rec.contentHash" class="lal__rechash">{{ shortHash(rec.contentHash) }}</code>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in nodeRows(node).rows" :key="row.key">
                <td class="lal__rowlabel">
                  <Pill v-if="row.kind === 'block'" tone="dim">{{ row.label }}</Pill>
                  <span v-else class="lal__stmtlabel">{{ row.label }}</span>
                </td>
                <td
                  v-for="rec in node.records"
                  :key="rec.id"
                  class="lal__cell"
                  :class="{ 'lal__cell--null': cellFor(row, rec) === null }"
                >
                  <pre v-if="cellFor(row, rec) !== null" class="lal__cellpre">{{ describeCell(cellFor(row, rec)) }}</pre>
                  <span v-else class="lal__cellnull">·</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <details v-if="ruleSnapshotEntries.length > 0" class="lal__snapshots">
        <summary>
          {{ ruleSnapshotEntries.length }} rule snapshot{{ ruleSnapshotEntries.length === 1 ? '' : 's' }}
        </summary>
        <div v-for="[hash, snap] in ruleSnapshotEntries" :key="hash" class="lal__snapshot">
          <header>
            <code>{{ shortHash(hash) }}</code>
            <span v-if="snap.capturedFirstAt" class="lal__snapwhen">
              first seen {{ new Date(snap.capturedFirstAt).toISOString() }}
            </span>
          </header>
          <pre class="lal__snappre">{{ snap.content }}</pre>
        </div>
      </details>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="lal__hint">
      pick a LAL rule and hit start. each captured log record fills
      one column; block rows show the parsed/extractor/sink/output
      view, statement granularity adds one row per DSL line.
    </p>
  </div>
</template>

<style scoped>
.lal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.lal__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.lal__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.lal__label {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.lal__select {
  min-width: 240px;
}

.lal__select,
.lal__input {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 4px 8px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
}

.lal__input {
  width: 90px;
}

.lal__toggle {
  display: inline-flex;
  border: 1px solid var(--rr-border);
}

.lal__pill {
  padding: 4px 10px;
  background: var(--rr-bg2);
  color: var(--rr-dim);
  border: 0;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  cursor: pointer;
}

.lal__pill--active {
  background: var(--rr-bg3);
  color: var(--rr-heading);
}

.lal__blocks {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.lal__blockcheck {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  cursor: pointer;
}

.lal__statepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.lal__sid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.lal__warn {
  font-size: 11px;
  color: var(--rr-warn, #d4a93b);
  background: var(--rr-bg2);
  padding: 6px 10px;
  border-left: 2px solid var(--rr-warn, #d4a93b);
  margin: 0;
}

.lal__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 12px;
  margin: 0;
}

.lal__capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px;
}

.lal__captureh {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lal__rulename {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 13px;
}

.lal__node {
  border: 1px solid var(--rr-border);
}

.lal__nodeh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.lal__nodeid {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-heading);
}

.lal__nodeempty {
  padding: 14px;
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11.5px;
}

.lal__gridwrap {
  overflow-x: auto;
}

.lal__grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  table-layout: fixed;
}

.lal__grid th,
.lal__grid td {
  border-bottom: 1px solid var(--rr-border);
  border-right: 1px solid var(--rr-border);
  padding: 6px 8px;
  vertical-align: top;
}

.lal__rowlabel {
  width: 110px;
  text-align: left;
}

.lal__reccol {
  min-width: 200px;
  max-width: 320px;
  text-align: left;
}

.lal__rechead {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-dim);
}

.lal__recid {
  color: var(--rr-heading);
  font-weight: 600;
}

.lal__recsvc {
  color: var(--rr-ink2);
}

.lal__rects {
  color: var(--rr-dim);
}

.lal__recsink {
  margin-top: 3px;
}

.lal__rechash {
  display: block;
  margin-top: 3px;
  font-family: var(--rr-font-mono);
  color: var(--rr-dim);
}

.lal__cell {
  background: var(--rr-bg);
}

.lal__cell--null {
  background: var(--rr-bg2);
  text-align: center;
}

.lal__cellpre {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}

.lal__cellnull {
  color: var(--rr-dim);
}

.lal__stmtlabel {
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  color: var(--rr-dim);
  font-style: italic;
}

.lal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}

.lal__snapshots {
  border-top: 1px solid var(--rr-border);
  padding-top: 8px;
}

.lal__snapshots summary {
  cursor: pointer;
  color: var(--rr-dim);
  font-size: 11.5px;
}

.lal__snapshot {
  margin-top: 8px;
}

.lal__snapshot header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--rr-dim);
}

.lal__snapwhen {
  font-style: italic;
}

.lal__snappre {
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
