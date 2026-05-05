<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * OAL live-debugger view — SWIP-13 §1 OAL section + §7 design.
 *
 * Layout:
 *   - rule picker fed from /runtime/oal/rules.
 *   - capture controls: maxRecords, windowSec, Start/Stop.
 *   - cluster coverage strip.
 *   - 5-stage waterfall per captured Source row: source → filter[i]
 *     → build_metrics → aggregation → emit. The two implicit stages
 *     render with an "(implicit)" badge per SWIP §1.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  OalRuleSnapshot,
  OalStageRecord,
  RuleSnapshot,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';

const dbg = useDebugSession('oal');
const selectedKey = ref<string>(''); // `${file}/${ruleName}`
const maxRecords = ref<number>(50);
const windowSec = ref<number>(60);

const rulesQuery = useQuery({
  queryKey: ['debug-oal/rules'],
  queryFn: async (): Promise<OalRuleSnapshot[]> => bff.oalRules(),
});

const ruleOptions = computed<OalRuleSnapshot[]>(() => {
  const rules = rulesQuery.data.value ?? [];
  return [...rules].sort((a, b) =>
    `${a.file}/${a.ruleName}`.localeCompare(`${b.file}/${b.ruleName}`),
  );
});

const selectedRule = computed<OalRuleSnapshot | null>(() => {
  if (!selectedKey.value) return null;
  return ruleOptions.value.find((r) => `${r.file}/${r.ruleName}` === selectedKey.value) ?? null;
});

const startEnabled = computed(() => {
  const s = dbg.state.value;
  return (
    selectedRule.value !== null &&
    (s === 'idle' || s === 'captured' || s === 'expired' || s === 'stopped' || s === 'error')
  );
});

const stopEnabled = computed(
  () => dbg.state.value === 'capturing' || dbg.state.value === 'starting',
);

async function startSampling(): Promise<void> {
  const r = selectedRule.value;
  if (!r) return;
  await dbg.start({
    catalog: 'oal',
    name: r.file,
    ruleName: r.ruleName,
    maxRecords: maxRecords.value,
    windowSec: windowSec.value,
  });
}

const oalSession = computed(() => {
  const s = dbg.session.value;
  return s && s.catalog === 'oal' ? s : null;
});

const ruleSnapshotEntries = computed<[string, RuleSnapshot][]>(() => {
  const s = oalSession.value;
  if (!s) return [];
  return Object.entries(s.ruleSnapshots ?? {});
});

function shortHash(h: string): string {
  return h ? h.slice(0, 8) : '—';
}

function stageTone(kind: OalStageRecord['kind']): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (kind) {
    case 'emit':
      return 'active';
    case 'aggregation':
      return 'info';
    case 'filter':
      return 'warn';
    case 'source':
      return 'ok';
    default:
      return 'dim';
  }
}

function isImplicit(kind: OalStageRecord['kind']): boolean {
  return kind === 'build_metrics' || kind === 'emit';
}

function describeFilter(rec: OalStageRecord): string {
  const f = rec.filter;
  if (!f) return '';
  const left = f.left ?? '?';
  const op = f.op ?? '?';
  const right = f.right ?? '?';
  return `${left} ${op} ${right} → ${f.kept ? 'kept' : 'dropped'}`;
}

function describeMetricsState(rec: OalStageRecord): string {
  if (!rec.metricsState) return '';
  return JSON.stringify(rec.metricsState, null, 2);
}

function describeSourceRow(rec: OalStageRecord): string {
  const s = rec.source;
  if (!s) return '';
  if (typeof s !== 'object' || s === null) return String(s);
  return JSON.stringify(s, null, 2);
}

/** Group consecutive records by their `source` boundary so each
 *  Source row's full pipeline renders as one block. SWIP §1 OAL
 *  emits stages in pipeline order — we delineate at every `source`
 *  record. */
interface RecordGroup {
  index: number;
  contentHash?: string;
  records: OalStageRecord[];
}

function groupBySourceRow(records: OalStageRecord[]): RecordGroup[] {
  const groups: RecordGroup[] = [];
  let cur: RecordGroup | null = null;
  let n = 0;
  for (const r of records) {
    if (r.kind === 'source') {
      n += 1;
      cur = { index: n, contentHash: r.contentHash, records: [r] };
      groups.push(cur);
    } else if (cur) {
      cur.records.push(r);
    } else {
      // Records before the first `source` (shouldn't happen, but be
      // safe) — start a synthetic group.
      n += 1;
      cur = { index: n, contentHash: r.contentHash, records: [r] };
      groups.push(cur);
    }
  }
  return groups;
}
</script>

<template>
  <div class="oal">
    <header class="oal__controls">
      <div class="oal__field">
        <label class="oal__label">rule</label>
        <select v-model="selectedKey" class="oal__select" :disabled="rulesQuery.isPending.value">
          <option value="" disabled>
            {{ rulesQuery.isPending.value ? 'loading…' : 'select an OAL rule…' }}
          </option>
          <option
            v-for="r in ruleOptions"
            :key="`${r.file}/${r.ruleName}`"
            :value="`${r.file}/${r.ruleName}`"
          >
            {{ r.file }} · {{ r.ruleName }} · {{ r.function }} · {{ shortHash(r.contentHash) }}
          </option>
        </select>
      </div>
      <div class="oal__field">
        <label class="oal__label">maxRecords</label>
        <input v-model.number="maxRecords" type="number" min="1" max="200" class="oal__input" />
      </div>
      <div class="oal__field">
        <label class="oal__label">windowSec</label>
        <input v-model.number="windowSec" type="number" min="1" max="600" class="oal__input" />
      </div>
      <Btn kind="primary" :disabled="!startEnabled" @click="startSampling">start sampling</Btn>
      <Btn kind="ghost" :disabled="!stopEnabled" @click="dbg.stop()">stop</Btn>
      <span class="oal__statepill">
        <Pill :tone="dbg.state.value === 'capturing' ? 'active' : dbg.state.value === 'error' ? 'err' : 'dim'">
          {{ dbg.state.value }}
        </Pill>
        <code v-if="dbg.sessionId.value" class="oal__sid">{{ dbg.sessionId.value }}</code>
      </span>
    </header>

    <p v-if="rulesQuery.isError.value" class="oal__error">
      Could not load OAL rules.
      <button type="button" @click="rulesQuery.refetch()">retry</button>
    </p>

    <p v-if="dbg.error.value" class="oal__error">{{ dbg.error.value }}</p>

    <div v-if="selectedRule" class="oal__rulecard">
      <header>
        <span class="oal__rulekey">{{ selectedRule.file }} · {{ selectedRule.ruleName }}</span>
        <Pill tone="info">{{ selectedRule.sourceScope }}</Pill>
        <code class="oal__rulefn">{{ selectedRule.function }}</code>
      </header>
      <code class="oal__ruleexpr">{{ selectedRule.expression }}</code>
    </div>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (oalSession?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="oalSession?.nodes ?? []"
      :replaced-prior-ids="dbg.replacedPriorIds.value"
    />

    <section v-if="oalSession" class="oal__capture">
      <header class="oal__captureh">
        <span class="oal__rulename">
          oal · {{ oalSession.name }} · {{ oalSession.ruleName }}
        </span>
        <Pill v-if="oalSession.reason" :tone="oalSession.reason === 'manual_stop' ? 'dim' : 'info'">
          {{ oalSession.reason }}
        </Pill>
      </header>

      <div v-for="node in oalSession.nodes" :key="node.nodeId" class="oal__node">
        <header class="oal__nodeh">
          <span class="oal__nodeid">{{ node.nodeId }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : 'warn'">{{ node.status }}</Pill>
        </header>

        <div v-if="!node.records || node.records.length === 0" class="oal__nodeempty">
          no source rows captured on this node
        </div>

        <div v-else class="oal__groups">
          <article
            v-for="g in groupBySourceRow(node.records)"
            :key="g.index"
            class="oal__group"
          >
            <header class="oal__grouph">
              <span class="oal__groupid">source row #{{ g.index }}</span>
              <code v-if="g.contentHash" class="oal__hash">{{ shortHash(g.contentHash) }}</code>
            </header>
            <table class="oal__waterfall">
              <thead>
                <tr>
                  <th class="oal__line">ln</th>
                  <th class="oal__source">clause</th>
                  <th class="oal__kind">stage</th>
                  <th class="oal__result">result</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(rec, idx) in g.records" :key="`${rec.id}-${idx}`">
                  <td class="oal__line">{{ rec.sourceLine ?? '—' }}</td>
                  <td class="oal__source">
                    <code v-if="rec.sourceText">{{ rec.sourceText }}</code>
                    <span v-else class="oal__implicit">(implicit)</span>
                  </td>
                  <td class="oal__kind">
                    <Pill :tone="stageTone(rec.kind)">{{ rec.kind }}</Pill>
                    <Pill v-if="isImplicit(rec.kind)" tone="dim">implicit</Pill>
                  </td>
                  <td class="oal__result">
                    <pre v-if="rec.kind === 'source'" class="oal__pre">{{ describeSourceRow(rec) }}</pre>
                    <div v-else-if="rec.kind === 'filter'" class="oal__filterresult">
                      <Pill :tone="rec.filter?.kept ? 'ok' : 'warn'">
                        {{ rec.filter?.kept ? 'kept' : 'dropped' }}
                      </Pill>
                      <code>{{ describeFilter(rec) }}</code>
                    </div>
                    <template v-else-if="rec.kind === 'build_metrics' || rec.kind === 'aggregation' || rec.kind === 'emit'">
                      <div v-if="rec.metricsClass" class="oal__metricsclass">
                        <code>{{ rec.metricsClass }}</code>
                      </div>
                      <pre v-if="rec.metricsState" class="oal__pre">{{ describeMetricsState(rec) }}</pre>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </article>
        </div>
      </div>

      <details v-if="ruleSnapshotEntries.length > 0" class="oal__snapshots">
        <summary>
          {{ ruleSnapshotEntries.length }} rule snapshot{{ ruleSnapshotEntries.length === 1 ? '' : 's' }}
        </summary>
        <div v-for="[hash, snap] in ruleSnapshotEntries" :key="hash" class="oal__snapshot">
          <header>
            <code>{{ shortHash(hash) }}</code>
            <span v-if="snap.capturedFirstAt" class="oal__snapwhen">
              first seen {{ new Date(snap.capturedFirstAt).toISOString() }}
            </span>
          </header>
          <pre class="oal__snappre">{{ snap.content }}</pre>
        </div>
      </details>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="oal__hint">
      pick an OAL rule and hit start. each captured Source row produces
      a 5-stage waterfall — source, filter[i], build_metrics,
      aggregation, emit. build_metrics + emit are compiler-emitted and
      render with an (implicit) badge.
    </p>
  </div>
</template>

<style scoped>
.oal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.oal__controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.oal__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.oal__label {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.oal__select {
  min-width: 360px;
}

.oal__select,
.oal__input {
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  padding: 4px 8px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
}

.oal__input {
  width: 90px;
}

.oal__statepill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.oal__sid {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__error {
  padding: 8px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-err, #f44);
  color: var(--rr-err, #f44);
  font-size: 12px;
  margin: 0;
}

.oal__rulecard {
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.oal__rulecard header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.oal__rulekey {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12.5px;
}

.oal__rulefn {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
}

.oal__ruleexpr {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-ink2);
  background: var(--rr-bg);
  padding: 4px 8px;
  white-space: pre-wrap;
}

.oal__capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px;
}

.oal__captureh {
  display: flex;
  align-items: center;
  gap: 10px;
}

.oal__rulename {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 13px;
}

.oal__node {
  border: 1px solid var(--rr-border);
}

.oal__nodeh {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
}

.oal__nodeid {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-heading);
}

.oal__nodeempty {
  padding: 14px;
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11.5px;
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
  font-size: 11px;
  color: var(--rr-heading);
}

.oal__hash {
  font-family: var(--rr-font-mono);
  font-size: 10px;
  color: var(--rr-dim);
}

.oal__waterfall {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.oal__waterfall th {
  text-align: left;
  padding: 6px 8px;
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
}

.oal__waterfall td {
  padding: 6px 8px;
  vertical-align: top;
  border-bottom: 1px solid var(--rr-border);
}

.oal__line {
  width: 36px;
  font-family: var(--rr-font-mono);
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

.oal__implicit {
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11.5px;
}

.oal__kind {
  width: 160px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.oal__filterresult {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
}

.oal__filterresult code {
  color: var(--rr-ink2);
}

.oal__metricsclass {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  margin-bottom: 4px;
}

.oal__pre {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  background: var(--rr-bg);
  padding: 4px 6px;
}

.oal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}

.oal__snapshots {
  border-top: 1px solid var(--rr-border);
  padding-top: 8px;
}

.oal__snapshots summary {
  cursor: pointer;
  color: var(--rr-dim);
  font-size: 11.5px;
}

.oal__snapshot {
  margin-top: 8px;
}

.oal__snapshot header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__snapwhen {
  font-style: italic;
}

.oal__snappre {
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
