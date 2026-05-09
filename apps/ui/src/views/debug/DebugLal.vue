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
 * Each LAL execution shows up as one `SessionRecord` whose `samples[]`
 * walks `input → function → output` stages. Sample payloads carry the
 * unified envelope `{aborted, hasParsed, input?, output?, parsedKeys}`
 * — `input` populated on the first sample (raw `LogData` /
 * `Message`), `output` populated on every sample after `bindInput`
 * (the `LogBuilder` snapshot, including the merged `tags[]` with
 * `original | lal-added | lal-override` status).
 *
 * Statement-mode capture (`granularity=statement`) appends an extra
 * record per DSL statement, with `sample.sourceLine` pointing at the
 * 1-based DSL-block line that fired.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type {
  BundledEntry,
  Granularity,
  LalLogBuilderOutput,
  LalLogDataInput,
  LalSamplePayload,
  ListEnvelope,
  NodeSlice,
  SampleType,
  SessionRecord,
  SessionResponse,
  SessionSample,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import { useDebugHistory, type HistoryEntry } from '../../composables/useDebugHistory.js';
import Btn from '../../design/primitives/Btn.vue';
import DebugView from './DebugView.vue';
import { isLalSamplePayload } from './payload.js';

const route = useRoute();
const dbg = useDebugSession('lal');
const history = useDebugHistory('lal');
/** A LAL "rule" in the catalog is a YAML **file** — e.g.
 *  `default`, `envoy-ai-gateway`. Each file's body has a `rules:`
 *  list, and OAP keys the debug install on
 *  `(catalog=lal, name=<file>, ruleName=<inner-rule-name>)`. So
 *  the picker has two levels: the file (selectedFile) AND a rule
 *  drilled out of the file's YAML body. */
const selectedFile = ref<string>('');
const selectedRule = ref<string>('');
const granularity = ref<Granularity>('block');
// SessionLimits.MAX_RECORD_CAP on the OAP side is 100 (and so is the
// default). The input is bounded the same way; lower if a single
// execution is enough or you want the captured page tighter.
const recordCap = ref<number>(100);
const retentionMinutes = ref<number>(5);

/** Deep-link from a LAL rule card / Monaco gutter — `?file=&name=`
 *  pre-fills both. `name` is the inner ruleName; `file` is the LAL
 *  file. Older callers that only pass `?name=` get the file inferred
 *  (the inner rule and file share a name in single-rule files). */
watch(
  () => [route.query.name, route.query.file] as const,
  ([n, f]) => {
    if (typeof f === 'string' && f.length > 0) {
      selectedFile.value = f;
    } else if (typeof n === 'string' && n.length > 0) {
      // backward-compat: single-rule files where rule == file basename
      selectedFile.value = n;
    }
    if (typeof n === 'string' && n.length > 0) {
      selectedRule.value = n;
    }
  },
  { immediate: true },
);

// File picker feed: `/runtime/rule/list` (operator-pushed +
// dslManager-tracked) ∪ `/runtime/rule/bundled` (every shipped LAL
// rule file). On a fresh OAP `/list` is empty while `/bundled` has
// the catalogue, so the merge keeps the dropdown populated.
const listQuery = useQuery({
  queryKey: ['debug-lal/list'],
  queryFn: async (): Promise<ListEnvelope> => bff.catalogList('lal'),
});

const bundledQuery = useQuery({
  queryKey: ['debug-lal/bundled'],
  queryFn: async (): Promise<BundledEntry[]> => bff.catalogBundled('lal', false),
});

const fileNames = computed<string[]>(() => {
  const seen = new Set<string>();
  const env = listQuery.data.value;
  if (env) for (const r of env.rules) seen.add(r.name);
  for (const e of bundledQuery.data.value ?? []) seen.add(e.name);
  return [...seen].sort((a, b) => a.localeCompare(b));
});

/** Pull the selected LAL file's YAML so we can extract its inner
 *  `rules[].name` list. Same shape as MAL — a regex over the body
 *  is enough since the YAML structure is rigid. */
const ruleContentQuery = useQuery({
  queryKey: computed(() => ['debug-lal/content', selectedFile.value]),
  queryFn: async (): Promise<string | null> => {
    if (!selectedFile.value) return null;
    const got = await bff.getRule({ catalog: 'lal', name: selectedFile.value });
    return got?.content ?? null;
  },
  enabled: computed(() => selectedFile.value !== ''),
  staleTime: 30_000,
});

const RULE_NAME_RE = /^[ \t]*-[ \t]+name:[ \t]*([A-Za-z_][A-Za-z0-9_-]*)/gm;
const innerRuleNames = computed<string[]>(() => {
  const c = ruleContentQuery.data.value;
  if (!c) return [];
  const seen = new Set<string>();
  for (const m of c.matchAll(RULE_NAME_RE)) {
    seen.add(m[1]!);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
});

/** When the file changes, reset the rule selection if it isn't part
 *  of the new file's rule list. Keeps deep-link preselect intact. */
watch(innerRuleNames, (names) => {
  if (selectedRule.value && names.length > 0 && !names.includes(selectedRule.value)) {
    selectedRule.value = '';
  }
});

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedFile.value !== '' &&
    selectedRule.value !== '' &&
    (s === 'idle' || s === 'captured' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  if (!selectedFile.value || !selectedRule.value) return;
  await dbg.start({
    catalog: 'lal',
    name: selectedFile.value,
    ruleName: selectedRule.value,
    granularity: granularity.value,
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface LalCell {
  rec: SessionRecord;
  recIdx: number;
  sample: SessionSample;
  payload: LalSamplePayload | null;
}

/** A row in the per-record × per-block grid. `key` uniquely identifies
 *  the row across statement-mode (where multiple `function` samples
 *  fire per record at distinct DSL lines). */
interface LalStep {
  key: string;
  type: SampleType;
  /** 1-based DSL line in statement mode; 0 for block-level samples. */
  sourceLine: number;
  /** Display label — sample type for input/output, or `function@LINE`
   *  for statement-mode functions. */
  label: string;
}

interface LalRecordView {
  rec: SessionRecord;
  recIdx: number;
}

interface LalNodeView extends NodeSlice {
  records: SessionRecord[];
  recordViews: LalRecordView[];
  steps: LalStep[];
  /** stepKey → recIdx → cell. Lookup with `cellAt(view, step, recIdx)`. */
  cells: Map<string, Map<number, LalCell>>;
}

function stepKeyOf(s: SessionSample): string {
  return `${s.type}@${s.sourceLine ?? 0}`;
}

// ── Historical replay ──────────────────────────────────────────────

const historicalEntry = shallowRef<HistoryEntry | null>(null);

const displaySession = computed<SessionResponse | null>(
  () => historicalEntry.value?.session ?? dbg.session.value,
);

function loadHistorical(entry: HistoryEntry): void {
  historicalEntry.value = entry;
  selectedFile.value = entry.name;
  selectedRule.value = entry.ruleName;
  if (entry.granularity === 'block' || entry.granularity === 'statement') {
    granularity.value = entry.granularity;
  }
  if (entry.recordCap !== undefined) recordCap.value = entry.recordCap;
  if (entry.retentionMillis !== undefined) {
    retentionMinutes.value = Math.max(1, Math.round(entry.retentionMillis / 60_000));
  }
  selectedCell.value = null;
}

function clearHistorical(): void {
  historicalEntry.value = null;
  selectedCell.value = null;
}

function persistCapture(): void {
  if (historicalEntry.value !== null) return;
  const id = dbg.sessionId.value;
  if (!id || !selectedFile.value || !selectedRule.value) return;
  const sess: SessionResponse = dbg.session.value ?? {
    sessionId: id,
    capturedAt: Date.now(),
    nodes: [],
  };
  history.save({
    widget: 'lal',
    catalog: 'lal',
    name: selectedFile.value,
    ruleName: selectedRule.value,
    granularity: granularity.value,
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
    selectedRule.value = entry.ruleName;
    if (entry.granularity === 'block' || entry.granularity === 'statement') {
      granularity.value = entry.granularity;
    }
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

const nodeViews = computed<LalNodeView[]>(() => {
  const s = displaySession.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const records = n.records ?? [];
    const recordViews: LalRecordView[] = records.map((rec, recIdx) => ({ rec, recIdx }));
    const steps: LalStep[] = [];
    const seen = new Set<string>();
    const cells = new Map<string, Map<number, LalCell>>();
    for (let recIdx = 0; recIdx < records.length; recIdx++) {
      const rec = records[recIdx]!;
      for (const sample of rec.samples ?? []) {
        const key = stepKeyOf(sample);
        if (!seen.has(key)) {
          seen.add(key);
          const sourceLine = sample.sourceLine ?? 0;
          const label =
            sample.type === 'function' && sourceLine > 0
              ? `function @${sourceLine}`
              : sample.type;
          steps.push({ key, type: sample.type, sourceLine, label });
        }
        let perRec = cells.get(key);
        if (!perRec) {
          perRec = new Map();
          cells.set(key, perRec);
        }
        perRec.set(recIdx, {
          rec,
          recIdx,
          sample,
          payload: isLalSamplePayload(sample.payload) ? sample.payload : null,
        });
      }
    }
    return { ...n, records, recordViews, steps, cells };
  });
});

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

function cellAt(view: LalNodeView, step: LalStep, recIdx: number): LalCell | undefined {
  return view.cells.get(step.key)?.get(recIdx);
}

function logBuilderOutput(p: LalSamplePayload | null): LalLogBuilderOutput | null {
  if (!p?.output) return null;
  if (p.output.type !== 'LogBuilder') return null;
  return p.output as LalLogBuilderOutput;
}

function logDataInput(p: LalSamplePayload | null): LalLogDataInput | null {
  if (!p?.input) return null;
  if (p.input.type !== 'LogData') return null;
  return p.input as LalLogDataInput;
}

interface KvEntry {
  k: string;
  v: string;
  hl?: boolean;
}

const TAG_STATUS_TONE: Record<NonNullable<import('@vantage-studio/api-client').LalLogBuilderTag['status']>, string> = {
  original: 'rr-tag--orig',
  'lal-added': 'rr-tag--add',
  'lal-override': 'rr-tag--over',
};

function inputEntries(p: LalSamplePayload | null): KvEntry[] {
  const inp = logDataInput(p);
  if (!inp) return [];
  return [
    { k: 'service', v: inp.service ?? '—' },
    { k: 'endpoint', v: inp.endpoint ?? '—' },
    { k: 'instance', v: inp.serviceInstance ?? '—' },
    { k: 'layer', v: inp.layer ?? '—' },
  ];
}

function outputEntries(p: LalSamplePayload | null): KvEntry[] {
  const out = logBuilderOutput(p);
  if (!out) return [];
  return [
    { k: 'service', v: out.service ?? '—' },
    { k: 'endpoint', v: out.endpoint ?? '—' },
    { k: 'timestamp', v: out.timestamp ? String(out.timestamp) : '—' },
  ];
}

function bodyPreview(p: LalSamplePayload | null): string {
  const inp = logDataInput(p);
  const text = inp?.body?.text;
  if (!text) return '';
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

function contentPreview(p: LalSamplePayload | null): string {
  const lb = logBuilderOutput(p);
  if (!lb?.content) return '';
  const t = lb.content.trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

// ── Selection + source pane ───────────────────────────────────────

/** Single selected cell drives the source-pane open-state and the
 *  `<mark>` highlight inside the captured DSL. */
const selectedCell = ref<LalCell | null>(null);

function selectCell(cell: LalCell): void {
  selectedCell.value = selectedCell.value === cell ? null : cell;
}

// ── Single-record expand mode ─────────────────────────────────────

/** When set, the matrix view collapses to a single record (full width
 *  per cell — input / function@N / output stacked vertically). The
 *  matrix is dense by design (one column per record), so an operator
 *  drilling into one log line that has long content benefits from
 *  losing the column constraint. Click "← matrix" on the expanded
 *  view to drop back. */
const expandedRecord = ref<{ nodeKey: string; recIdx: number } | null>(null);

function expandRecord(nKey: string, recIdx: number): void {
  expandedRecord.value = { nodeKey: nKey, recIdx };
}

function backToMatrix(): void {
  expandedRecord.value = null;
}

function expandedRecordView(view: LalNodeView): LalRecordView | null {
  const e = expandedRecord.value;
  if (e === null || e.nodeKey !== nodeKey(view)) return null;
  return view.recordViews.find((r) => r.recIdx === e.recIdx) ?? null;
}

// ── Search + display limit ────────────────────────────────────────

/** Free-text filter on log content. A record matches when ANY of its
 *  samples carry text containing the substring (case-insensitive):
 *    - input LogData body.text
 *    - output LogBuilder.content
 *    - any LogBuilder tag key/value
 *  Empty query matches everything. */
const searchQuery = ref<string>('');
/** UI-side cap so a busy capture doesn't render hundreds of columns
 *  at once; operators raise this when they want the full set. */
const displayLimit = ref<number>(20);

function recordMatches(rec: SessionRecord, q: string): boolean {
  if (q === '') return true;
  const needle = q.toLowerCase();
  for (const sample of rec.samples ?? []) {
    if (!isLalSamplePayload(sample.payload)) continue;
    const p = sample.payload;
    if (p.input?.type === 'LogData') {
      const body = (p.input as LalLogDataInput).body;
      const text = body?.text;
      if (typeof text === 'string' && text.toLowerCase().includes(needle)) return true;
    }
    if (p.output?.type === 'LogBuilder') {
      const out = p.output as LalLogBuilderOutput;
      if (typeof out.content === 'string' && out.content.toLowerCase().includes(needle)) {
        return true;
      }
      for (const t of out.tags ?? []) {
        if (
          t.key.toLowerCase().includes(needle) ||
          t.value.toLowerCase().includes(needle)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Per-node post-filter view. Keeps the cells map intact (lookups
 *  are by recIdx and the surviving recordViews carry their original
 *  ids), trims `recordViews` to matching + capped subset. */
function displayedRecords(view: LalNodeView): LalRecordView[] {
  const q = searchQuery.value.trim();
  const matched = q === ''
    ? view.recordViews
    : view.recordViews.filter((rv) => recordMatches(rv.rec, q));
  return matched.slice(0, displayLimit.value);
}

function matchedRecordCount(view: LalNodeView): number {
  const q = searchQuery.value.trim();
  if (q === '') return view.recordViews.length;
  return view.recordViews.filter((rv) => recordMatches(rv.rec, q)).length;
}

const sourceDsl = computed<string | null>(() => {
  const sel = selectedCell.value;
  if (sel) return sel.rec.dsl ?? null;
  const s = displaySession.value;
  if (!s) return null;
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const recs = s.nodes[i]!.records;
    if (recs && recs.length > 0) return recs[recs.length - 1]!.dsl ?? null;
  }
  return null;
});

const sourceLabel = computed<string>(() => {
  const sel = selectedCell.value;
  if (!sel) return 'most recent record';
  return `record ${sel.recIdx + 1} · ${sel.sample.type}${sel.sample.sourceLine ? ` @${sel.sample.sourceLine}` : ''}`;
});

interface SourceSegment {
  text: string;
  highlight: boolean;
}

const sourceSegments = computed<SourceSegment[]>(() => {
  const dsl = sourceDsl.value;
  if (!dsl) return [];
  const fragment = selectedCell.value?.sample.sourceText.trim() ?? '';
  if (fragment === '') return [{ text: dsl, highlight: false }];
  const segments: SourceSegment[] = [];
  let cursor = 0;
  while (cursor < dsl.length) {
    const at = dsl.indexOf(fragment, cursor);
    if (at < 0) {
      segments.push({ text: dsl.slice(cursor), highlight: false });
      break;
    }
    if (at > cursor) segments.push({ text: dsl.slice(cursor, at), highlight: false });
    segments.push({ text: fragment, highlight: true });
    cursor = at + fragment.length;
  }
  return segments;
});

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms3 = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms3}`;
}

function recordTitle(view: LalRecordView): string {
  return `record ${view.recIdx + 1} · ${formatTime(view.rec.startedAtMs)}`;
}

void TAG_STATUS_TONE;

</script>

<template>
  <DebugView
    :dbg="dbg"
    :node-views="nodeViews"
    :source-open="selectedCell !== null"
    :view-session="historicalEntry?.session ?? null"
  >
    <template #controls>
      <div class="ctl">
        <label class="ctl__lbl">rule file</label>
        <select v-model="selectedFile" class="ctl__select">
          <option value="" disabled>select a LAL rule file…</option>
          <option v-for="n in fileNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="ctl ctl--grow">
        <label class="ctl__lbl">rule</label>
        <select
          v-model="selectedRule"
          class="ctl__select"
          :disabled="selectedFile === '' || ruleContentQuery.isPending.value"
        >
          <option value="" disabled>
            {{ selectedFile === ''
                ? 'pick a file first…'
                : ruleContentQuery.isPending.value
                  ? 'loading…'
                  : innerRuleNames.length === 0
                    ? 'no rules found in file'
                    : 'select a rule…' }}
          </option>
          <option v-for="r in innerRuleNames" :key="r" :value="r">{{ r }}</option>
        </select>
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
        <input v-model.number="recordCap" type="number" min="1" max="100" class="ctl__input" />
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
        :to="{ path: '/edit', query: { catalog: 'lal', name: selectedFile } }"
        :title="`open lal · ${selectedFile} in the editor`"
      >open in editor →</router-link>
    </template>

    <template #banner>
      <div v-if="historicalEntry" class="lal__histbanner">
        <span class="lal__histbicon">⟲</span>
        <span>
          viewing saved capture from <strong>{{ formatTime(historicalEntry.savedAt) }}</strong>
          · {{ historicalEntry.catalog }} · {{ historicalEntry.name }} · {{ historicalEntry.ruleName }}
        </span>
        <button type="button" class="lal__histback" @click="clearHistorical">back to live</button>
      </div>
    </template>

    <template #subhead>
      <div class="lal__subhead">
        <label class="lal__searchwrap">
          <span class="lal__searchlbl">search</span>
          <input
            v-model="searchQuery"
            type="search"
            class="lal__searchinput"
            placeholder="filter records by log content / tag…"
          />
        </label>
        <label class="lal__limitwrap">
          <span class="lal__searchlbl">show first</span>
          <input
            v-model.number="displayLimit"
            type="number"
            min="1"
            max="100"
            class="lal__limitinput"
          />
        </label>
      </div>
    </template>

    <template #idle-hint>
      pick a LAL rule and hit start. each captured log becomes one
      column in the matrix; rows walk the per-record blocks
      <code>input → function → output</code> (statement granularity
      splits <code>function</code> per DSL line). click any cell to
      open the source pane with that record's captured DSL and the
      matching fragment highlighted.
    </template>

    <template #source-pane>
      <div class="lal__src">
        <header class="lal__srch">{{ sourceLabel }}</header>
        <pre
          v-if="sourceDsl"
          class="lal__srcbody"
        ><code><template
          v-for="(seg, i) in sourceSegments"
          :key="i"
        ><mark
          v-if="seg.highlight"
          class="lal__hl"
        >{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></code></pre>
        <p v-else class="lal__srcempty">no captured DSL yet.</p>
      </div>
    </template>

    <template #node-body="{ node }">
      <div v-if="node.recordViews.length === 0" class="lal__empty">
        no LAL records from this node
      </div>

      <!-- Expanded single-record mode — full-width per step. -->
      <div
        v-else-if="expandedRecordView(node) !== null"
        class="lal__solo"
      >
        <header class="lal__soloh">
          <button type="button" class="lal__solback" @click="backToMatrix">← matrix</button>
          <span class="lal__solotitle">{{ recordTitle(expandedRecordView(node)!) }}</span>
        </header>
        <article
          v-for="step in node.steps"
          :key="step.key"
          class="lal__solorow"
        >
          <header class="lal__solorowh">
            <span class="lal__stepkind">{{ step.label }}</span>
          </header>
          <template v-if="cellAt(node, step, expandedRecordView(node)!.recIdx) === undefined">
            <div class="lal__cellabsent">— no sample for this step in this record</div>
          </template>
          <template v-else>
            <template v-if="step.type === 'input'">
              <div class="lal__kvs">
                <div
                  v-for="kv in inputEntries(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)"
                  :key="kv.k"
                  class="lal__kv"
                >
                  <span class="lal__kvk">{{ kv.k }}</span>
                  <span class="lal__kvv">{{ kv.v }}</span>
                </div>
              </div>
              <div
                v-if="bodyPreview(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)"
                class="lal__body"
              >
                {{ bodyPreview(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null) }}
              </div>
            </template>
            <template v-else>
              <div class="lal__kvs">
                <div
                  v-for="kv in outputEntries(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)"
                  :key="kv.k"
                  class="lal__kv"
                >
                  <span class="lal__kvk">{{ kv.k }}</span>
                  <span class="lal__kvv">{{ kv.v }}</span>
                </div>
              </div>
              <div
                v-if="logBuilderOutput(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)?.tags?.length"
                class="lal__tags"
              >
                <span
                  v-for="(t, ti) in logBuilderOutput(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)?.tags ?? []"
                  :key="ti"
                  class="lal__tag"
                  :class="{
                    'lal__tag--orig': t.status === 'original',
                    'lal__tag--add': t.status === 'lal-added',
                    'lal__tag--over': t.status === 'lal-override',
                  }"
                >{{ t.key }}={{ t.value }}</span>
              </div>
              <div
                v-if="contentPreview(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null)"
                class="lal__body"
              >
                {{ contentPreview(cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload ?? null) }}
              </div>
            </template>
            <div
              v-if="cellAt(node, step, expandedRecordView(node)!.recIdx)?.payload?.aborted"
              class="lal__abort"
            >aborted</div>
          </template>
        </article>
      </div>

      <!-- Default: per-record × per-block matrix. -->
      <div v-else class="lal__matrixwrap">
        <div
          v-if="displayedRecords(node).length === 0"
          class="lal__nomatch"
        >
          <template v-if="searchQuery.trim() === ''">no records on this node</template>
          <template v-else>
            no records match
            <code>{{ searchQuery }}</code>
            ({{ node.recordViews.length }} captured total)
          </template>
        </div>
        <div
          v-else
          class="lal__matrix"
          :style="`grid-template-columns: 180px repeat(${displayedRecords(node).length}, minmax(200px, 1fr));`"
        >
          <!-- header row: blank label cell + record headers -->
          <div class="lal__hdrlbl">
            block ▾ / record →
            <div class="lal__hdrlblct">
              showing {{ displayedRecords(node).length }}
              of {{ matchedRecordCount(node) }}
              <span v-if="matchedRecordCount(node) !== node.recordViews.length">
                · {{ node.recordViews.length }} captured
              </span>
            </div>
          </div>
          <div
            v-for="rv in displayedRecords(node)"
            :key="`${nodeKey(node)}-h-${rv.recIdx}`"
            class="lal__hdrec"
            :class="{
              'lal__hdrec--pinned':
                selectedCell !== null && selectedCell.recIdx === rv.recIdx,
            }"
          >
            <div class="lal__hdrtitle">
              {{ recordTitle(rv) }}
              <button
                type="button"
                class="lal__expandbtn"
                title="expand this record to full width"
                @click.stop="expandRecord(nodeKey(node), rv.recIdx)"
              >⤢</button>
            </div>
          </div>

          <!-- step rows -->
          <template v-for="step in node.steps" :key="step.key">
            <div class="lal__steplbl">
              <div class="lal__stepkind">{{ step.label }}</div>
              <div class="lal__stepct">
                {{ displayedRecords(node).filter((rv) => cellAt(node, step, rv.recIdx) !== undefined).length }}
                / {{ displayedRecords(node).length }} records
              </div>
            </div>
            <div
              v-for="rv in displayedRecords(node)"
              :key="`${step.key}-${rv.recIdx}`"
              class="lal__cell"
              :class="{
                'lal__cell--selected':
                  selectedCell !== null &&
                  selectedCell.recIdx === rv.recIdx &&
                  selectedCell.sample === cellAt(node, step, rv.recIdx)?.sample,
                'lal__cell--pinned':
                  selectedCell !== null && selectedCell.recIdx === rv.recIdx,
                'lal__cell--missing': cellAt(node, step, rv.recIdx) === undefined,
              }"
              @click="(() => { const c = cellAt(node, step, rv.recIdx); if (c) selectCell(c); })()"
            >
              <template v-if="cellAt(node, step, rv.recIdx) === undefined">
                <span class="lal__cellabsent">—</span>
              </template>
              <template v-else>
                <!-- input: LogData -->
                <template v-if="step.type === 'input'">
                  <div class="lal__kvs">
                    <div v-for="kv in inputEntries(cellAt(node, step, rv.recIdx)?.payload ?? null)" :key="kv.k" class="lal__kv">
                      <span class="lal__kvk">{{ kv.k }}</span>
                      <span class="lal__kvv">{{ kv.v }}</span>
                    </div>
                  </div>
                  <div v-if="bodyPreview(cellAt(node, step, rv.recIdx)?.payload ?? null)" class="lal__body">
                    {{ bodyPreview(cellAt(node, step, rv.recIdx)?.payload ?? null) }}
                  </div>
                </template>

                <!-- function / output: LogBuilder snapshot -->
                <template v-else>
                  <div class="lal__kvs">
                    <div v-for="kv in outputEntries(cellAt(node, step, rv.recIdx)?.payload ?? null)" :key="kv.k" class="lal__kv">
                      <span class="lal__kvk">{{ kv.k }}</span>
                      <span class="lal__kvv">{{ kv.v }}</span>
                    </div>
                  </div>
                  <div
                    v-if="logBuilderOutput(cellAt(node, step, rv.recIdx)?.payload ?? null)?.tags?.length"
                    class="lal__tags"
                  >
                    <span
                      v-for="(t, ti) in logBuilderOutput(cellAt(node, step, rv.recIdx)?.payload ?? null)?.tags ?? []"
                      :key="ti"
                      class="lal__tag"
                      :class="{
                        'lal__tag--orig': t.status === 'original',
                        'lal__tag--add': t.status === 'lal-added',
                        'lal__tag--over': t.status === 'lal-override',
                      }"
                    >{{ t.key }}={{ t.value }}</span>
                  </div>
                  <div v-if="contentPreview(cellAt(node, step, rv.recIdx)?.payload ?? null)" class="lal__body">
                    {{ contentPreview(cellAt(node, step, rv.recIdx)?.payload ?? null) }}
                  </div>
                </template>
                <div v-if="cellAt(node, step, rv.recIdx)?.payload?.aborted" class="lal__abort">aborted</div>
              </template>
            </div>
          </template>
        </div>
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
  min-width: 240px;
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
  font-size: 15.5px;
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
  font-size: 15px;
  color: var(--rr-dim);
  font-style: italic;
}

.lal__matrixwrap {
  overflow: auto;
  border: 1px solid var(--rr-border);
  /* Constrain the wrapper so both axes scroll INSIDE it — without a
     bound, vertical scroll cascades to the outer .dv ancestor and
     `position: sticky; left: 0` on the leftmost block-label column
     binds to the wrong scroll context (the steplbl scrolls out with
     the rest of the matrix instead of pinning). */
  max-height: calc(100vh - 280px);
  min-height: 200px;
}

.lal__matrix {
  display: grid;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  background: var(--rr-bg);
  min-width: 100%;
}

.lal__hdrlbl {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  background: var(--rr-bg2);
  padding: 8px 10px;
  border-right: 1px solid var(--rr-border);
  border-bottom: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.lal__hdrlblct {
  margin-top: 4px;
  font-family: var(--rr-font-mono);
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--rr-ink2);
}

.lal__subhead {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 4px 0;
}

.lal__searchwrap,
.lal__limitwrap {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-mono);
}

.lal__searchlbl {
  font-size: 11px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.lal__searchinput,
.lal__limitinput {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 3px 8px;
  font-family: var(--rr-font-mono);
  font-size: 13px;
}

.lal__searchinput {
  min-width: 320px;
}

.lal__limitinput {
  width: 60px;
}

.lal__nomatch {
  padding: 24px 18px;
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-dim);
  text-align: center;
  font-style: italic;
}

.lal__nomatch code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg2);
  padding: 1px 5px;
  font-style: normal;
  color: var(--rr-ink);
}

.lal__hdrec {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 10px;
  background: var(--rr-bg2);
  border-right: 1px solid var(--rr-border);
  border-bottom: 2px solid transparent;
  cursor: default;
}

.lal__hdrec--pinned {
  border-bottom-color: var(--rr-accent, var(--rr-active));
}

.lal__hdrtitle {
  color: var(--rr-heading);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.lal__expandbtn {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-family: var(--rr-font-mono);
  font-size: 11px;
  width: 20px;
  height: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.lal__expandbtn:hover {
  color: var(--rr-heading);
  border-color: var(--rr-ink2);
}

.lal__solo {
  border: 1px solid var(--rr-border);
  background: var(--rr-bg);
  display: flex;
  flex-direction: column;
}

.lal__soloh {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: var(--rr-bg2);
  border-bottom: 1px solid var(--rr-border);
}

.lal__solback {
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

.lal__solback:hover {
  color: var(--rr-heading);
  border-color: var(--rr-ink2);
}

.lal__solotitle {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-heading);
}

.lal__solorow {
  padding: 10px 14px;
  border-bottom: 1px solid var(--rr-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lal__solorow:last-child {
  border-bottom: none;
}

.lal__solorowh {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--rr-accent, var(--rr-active));
}

.lal__steplbl {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 10px 10px;
  background: var(--rr-bg);
  border-right: 1px solid var(--rr-border);
  border-bottom: 1px solid var(--rr-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lal__stepkind {
  color: var(--rr-heading);
  font-size: 12px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.lal__stepct {
  color: var(--rr-dim);
  font-size: 10px;
}

.lal__cell {
  padding: 8px 10px;
  border-right: 1px solid var(--rr-border);
  border-bottom: 1px solid var(--rr-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  background: transparent;
  min-width: 0;
}

.lal__cell:hover {
  background: var(--rr-bg2);
}

.lal__cell--pinned {
  background: rgba(143, 175, 199, 0.05);
}

.lal__cell--selected,
.lal__cell--selected:hover {
  background: var(--rr-bg3);
  outline: 1px solid var(--rr-accent, var(--rr-active));
  outline-offset: -1px;
}

.lal__cell--missing {
  cursor: default;
  background: var(--rr-bg);
  opacity: 0.5;
}

.lal__cellabsent {
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11px;
}

.lal__kvs {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 8px;
}

.lal__kv {
  display: contents;
}

.lal__kvk {
  color: var(--rr-dim);
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  align-self: center;
}

.lal__kvv {
  color: var(--rr-ink);
  word-break: break-all;
  font-size: 11px;
}

.lal__body {
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 4px 6px;
  color: var(--rr-ink2);
  font-size: 10.5px;
  line-height: 1.4;
  word-break: break-all;
  white-space: pre-wrap;
}

.lal__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.lal__tag {
  padding: 1px 5px;
  font-size: 10px;
  border: 1px solid var(--rr-border);
  background: var(--rr-bg);
  color: var(--rr-ink2);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lal__tag--orig {
  color: var(--rr-ink2);
}

.lal__tag--add {
  color: var(--rr-accent, var(--rr-active));
  border-color: var(--rr-accent, var(--rr-active));
}

.lal__tag--over {
  color: var(--rr-warn, #d6a96d);
  border-color: var(--rr-warn, #d6a96d);
}

.lal__abort {
  color: var(--rr-warn, #d6a96d);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.lal__src {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--rr-border);
  background: var(--rr-bg);
}

.lal__srch {
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
  font-family: var(--rr-font-mono);
  font-size: 13px;
  letter-spacing: 0.8px;
  color: var(--rr-dim);
}

.lal__srcbody {
  margin: 0;
  padding: 10px;
  font-family: var(--rr-font-mono);
  font-size: 13.5px;
  color: var(--rr-ink);
  white-space: pre-wrap;
  overflow: auto;
  flex: 1 1 auto;
}

.lal__srcempty {
  padding: 14px;
  margin: 0;
  color: var(--rr-dim);
  font-style: italic;
}

.lal__hl {
  background: var(--rr-accent, var(--rr-active));
  color: var(--rr-bg);
  padding: 1px 2px;
}

.lal__histbanner {
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

.lal__histbicon {
  color: var(--rr-warn, #d6a96d);
  font-size: 16px;
}

.lal__histback {
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

.lal__histback:hover {
  color: var(--rr-heading);
  border-color: var(--rr-ink2);
}
</style>
