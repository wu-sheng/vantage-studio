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
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import type {
  BundledEntry,
  Granularity,
  LalLogBuilderOutput,
  LalSamplePayload,
  ListEnvelope,
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
import { isLalSamplePayload, sampleTone } from './payload.js';
import { findLineMatches } from './sourceMatch.js';

const route = useRoute();
const dbg = useDebugSession('lal');
/** A LAL "rule" in the catalog is a YAML **file** — e.g.
 *  `default`, `envoy-ai-gateway`. Each file's body has a `rules:`
 *  list, and OAP keys the debug install on
 *  `(catalog=lal, name=<file>, ruleName=<inner-rule-name>)`. So
 *  the picker has two levels: the file (selectedFile) AND a rule
 *  drilled out of the file's YAML body. */
const selectedFile = ref<string>('');
const selectedRule = ref<string>('');
const granularity = ref<Granularity>('block');
// Default 100 records / session — small enough to keep BFF + OAP
// memory bounded for casual debugging; operators can dial up to
// 10 000 (upstream's hard cap) for longer captures.
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

interface LalSampleRow {
  rec: SessionRecord;
  sample: SessionSample;
  payload: LalSamplePayload | null;
}

interface LalNodeView extends NodeSlice {
  rows: LalSampleRow[];
}

const nodeViews = computed<LalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => {
    const rows: LalSampleRow[] = [];
    for (const rec of n.records ?? []) {
      for (const sample of rec.samples ?? []) {
        rows.push({
          rec,
          sample,
          payload: isLalSamplePayload(sample.payload) ? sample.payload : null,
        });
      }
    }
    return { ...n, rows };
  });
});

function nodeKey(n: NodeSlice): string {
  return n.nodeId ?? n.peer ?? '?';
}

/** Pull the `LogBuilder` output if the LAL payload has it — used for
 *  the `tags` summary cell. Returns null on `Message`-typed builders
 *  or when no output is bound yet. */
function logBuilderOutput(p: LalSamplePayload | null): LalLogBuilderOutput | null {
  if (!p?.output) return null;
  if (p.output.type !== 'LogBuilder') return null;
  return p.output as LalLogBuilderOutput;
}

function tagCount(p: LalSamplePayload | null, status: 'original' | 'lal-added' | 'lal-override'): number {
  const lb = logBuilderOutput(p);
  if (!lb?.tags) return 0;
  return lb.tags.filter((t) => t.status === status).length;
}

/** First-line preview of the LAL log content (truncated). */
function contentPreview(p: LalSamplePayload | null): string {
  const lb = logBuilderOutput(p);
  const c = lb?.content;
  if (!c) return '';
  const trimmed = c.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

// ── Source pane plumbing ────────────────────────────────────────────

const hoveredRow = ref<LalSampleRow | null>(null);

/** The source pane shows the LAL **file** body (which contains all
 *  inner rules), not just the selected inner rule. The OAP debug
 *  install passes `name=<file>` and `ruleName=<inner>`; the file is
 *  what's served by `/runtime/rule?catalog=lal&name=<file>`. */
const sourceCatalog = computed<'lal' | null>(() =>
  dbg.session.value === null || !selectedFile.value ? null : 'lal',
);
const sourceName = computed<string | null>(() =>
  dbg.session.value === null ? null : selectedFile.value || null,
);
const { source: ruleSource, query: sourceQuery } = useRuleSource({
  catalog: sourceCatalog,
  name: sourceName,
});

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

/** LAL highlights. Sample `sourceText` is empty for the input probe
 *  (no DSL fragment) — fall back to the per-sample `sourceLine` (only
 *  set in statement-mode) by computing it inside the rule body. The
 *  source pane lights nothing on input rows in block mode. */
const highlightedLines = computed<readonly number[]>(() => {
  const row = hoveredRow.value;
  const src = ruleSource.value;
  if (!row || !src) return [];
  if (row.sample.sourceText && row.sample.sourceText.length > 0) {
    return findLineMatches(src.content, row.sample.sourceText);
  }
  if (row.sample.sourceLine !== undefined && row.sample.sourceLine > 0) {
    return [row.sample.sourceLine];
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
        <input v-model.number="recordCap" type="number" min="1" max="10000" class="ctl__input" />
      </div>
      <div class="ctl">
        <label class="ctl__lbl">retention (min)</label>
        <input v-model.number="retentionMinutes" type="number" min="1" max="60" class="ctl__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <router-link
        v-if="selectedFile"
        class="ctl__editlink"
        :to="{ path: '/edit', query: { catalog: 'lal', name: selectedFile } }"
        :title="`open lal · ${selectedFile} in the editor`"
      >open in editor →</router-link>
    </template>

    <template #idle-hint>
      pick a LAL rule, set the file (typically <code>{ruleName}.yaml</code>),
      hit start. each captured log produces a sequence of samples — input
      (raw LogData), function (after bindInput; LogBuilder snapshot),
      output (terminal). statement granularity adds per-statement samples
      with a 1-based <code>sourceLine</code>. hover a row to highlight the
      matching DSL line in the source pane.
    </template>

    <template #source-pane>
      <DebugSourcePane
        :source="ruleSource"
        :loading="sourceQuery.isPending.value"
        :error="sourceQuery.error.value === null ? null : String(sourceQuery.error.value)"
        :highlighted-lines="highlightedLines"
        :page-dsl="pageDsl"
        lang="lal"
        @refetch="refetchSource"
      />
    </template>

    <template #node-body="{ node }">
      <div v-if="node.rows.length === 0" class="lal__empty">
        no LAL samples from this node
      </div>
      <table v-else class="lal__waterfall">
        <thead>
          <tr>
            <th class="lal__line">ln</th>
            <th class="lal__source">source</th>
            <th class="lal__kind">type</th>
            <th class="lal__cont">cont</th>
            <th class="lal__result">summary</th>
            <th class="lal__tags">tags (orig / added / over)</th>
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
            <td class="lal__line">{{ row.sample.sourceLine ?? '—' }}</td>
            <td class="lal__source"><code>{{ row.sample.sourceText || '—' }}</code></td>
            <td class="lal__kind">
              <Pill :tone="sampleTone(row.sample.type)">{{ row.sample.type }}</Pill>
            </td>
            <td class="lal__cont">
              <Pill :tone="row.sample.continueOn ? 'ok' : 'warn'">
                {{ row.sample.continueOn ? 'cont' : 'stop' }}
              </Pill>
            </td>
            <td class="lal__result">
              <template v-if="row.payload">
                <div class="lal__flags">
                  <span v-if="row.payload.aborted" class="lal__flag lal__flag--warn">aborted</span>
                  <span v-if="row.payload.hasParsed" class="lal__flag lal__flag--ok">parsed</span>
                  <span
                    v-if="row.payload.parsedKeys && row.payload.parsedKeys.length > 0"
                    class="lal__flag"
                  >parsed[{{ row.payload.parsedKeys.length }}]</span>
                </div>
                <div v-if="contentPreview(row.payload)" class="lal__preview">
                  <code>{{ contentPreview(row.payload) }}</code>
                </div>
              </template>
            </td>
            <td class="lal__tags">
              <span class="lal__tagcount">{{ tagCount(row.payload, 'original') }}</span>
              <span class="lal__tagsep">/</span>
              <span class="lal__tagcount">{{ tagCount(row.payload, 'lal-added') }}</span>
              <span class="lal__tagsep">/</span>
              <span class="lal__tagcount">{{ tagCount(row.payload, 'lal-override') }}</span>
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

.lal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 15.5px;
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
  font-size: 13px;
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
  width: 200px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
}

.lal__source code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}

.lal__kind {
  width: 110px;
}

.lal__cont {
  width: 70px;
}

.lal__result {
  font-family: var(--rr-font-mono);
  font-size: 15px;
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
  font-size: 13.5px;
  color: var(--rr-ink2);
}

.lal__flag--ok {
  color: var(--rr-ok, #5fa56f);
}

.lal__flag--warn {
  color: var(--rr-warn, #d4a93b);
}

.lal__preview {
  margin-top: 4px;
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-dim);
}

.lal__preview code {
  background: var(--rr-bg);
  padding: 1px 4px;
  color: var(--rr-ink2);
}

.lal__tags {
  width: 160px;
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-ink2);
}

.lal__tagcount {
  display: inline-block;
  min-width: 18px;
  text-align: right;
  color: var(--rr-ink);
}

.lal__tagsep {
  color: var(--rr-dim);
  margin: 0 4px;
}
</style>
