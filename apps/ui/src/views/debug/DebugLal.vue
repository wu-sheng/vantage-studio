<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * LAL live-debugger view.
 *
 * The actual wire (per `reference_swip13_actual_wire.md`) doesn't have a
 * `granularity` request param or per-block `blocks?[]` toggle yet — the
 * recorder emits stages directly: `text`, `parser`, `extractor`,
 * `outputRecord`, `outputMetric`. The `line` stage exists in code but
 * `LALDebugRecorderFactory` hard-codes statement-mode off, so it's
 * unreachable from the wire today; we render it if it ever appears.
 *
 * Each LAL record's payload is `{ sourceLine, body: { aborted,
 * hasOutput, hasParsed, extra: {...} } }`. There's no text/parsed/
 * extracted/sink sub-objects, no `sink` stage at all. The view renders
 * the source line gutter + booleans + per-stage extras, plus a
 * per-record column grid so operators can see one log record's pipeline
 * end-to-end.
 *
 * For LAL the `name` query param is the file name with extension
 * (e.g. `default.yaml`), and `ruleName` is the rule within the file.
 * `/runtime/rule/list?catalog=lal` returns rows where `name` is the
 * rule name; we don't currently know the file mapping, so the picker
 * prompts the operator for the file with extension (often the
 * default `<ruleName>.yaml` works, but the upstream loader binds
 * names directly).
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type {
  LalPayload,
  ListEnvelope,
  NodeSlice,
  SessionRecord,
  Stage,
} from '@vantage-studio/api-client';
import { bff } from '../../api/client.js';
import { useDebugSession } from '../../composables/useDebugSession.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';
import NodeCoverage from './NodeCoverage.vue';
import { isLalPayload, isLalRecord, shortHash } from './payload.js';

const dbg = useDebugSession('lal');
const selectedRule = ref<string>('');
/** LAL's file naming isn't surfaced by /runtime/rule/list; default to
 *  `<ruleName>.yaml` and let the operator override. */
const fileName = ref<string>('');
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
  // Default the file name to `<ruleName>.yaml` whenever the rule
  // changes; operator can edit if upstream uses a different binding.
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
    recordCap: recordCap.value,
    retentionMillis: retentionMinutes.value * 60 * 1000,
  });
}

interface LalNodeView extends NodeSlice {
  lalRecords: SessionRecord[];
}

const nodeViews = computed<LalNodeView[]>(() => {
  const s = dbg.session.value;
  if (!s) return [];
  return s.nodes.map((n) => ({
    ...n,
    lalRecords: (n.records ?? []).filter(isLalRecord),
  }));
});

function asLal(rec: SessionRecord): LalPayload | null {
  return isLalPayload(rec.payload) ? rec.payload : null;
}

function stageTone(stage: Stage): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (stage) {
    case 'text':
      return 'ok';
    case 'parser':
      return 'info';
    case 'extractor':
      return 'info';
    case 'outputRecord':
      return 'active';
    case 'outputMetric':
      return 'active';
    case 'line':
      return 'warn';
    default:
      return 'dim';
  }
}
</script>

<template>
  <div class="lal">
    <header class="lal__controls">
      <div class="lal__field">
        <label class="lal__label">rule</label>
        <select v-model="selectedRule" class="lal__select" @change="onRuleChange">
          <option value="" disabled>select a LAL rule…</option>
          <option v-for="n in ruleNames" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>
      <div class="lal__field">
        <label class="lal__label">file (with extension)</label>
        <input v-model="fileName" type="text" class="lal__input lal__input--wide" placeholder="default.yaml" />
      </div>
      <div class="lal__field">
        <label class="lal__label">recordCap</label>
        <input v-model.number="recordCap" type="number" min="1" max="10000" class="lal__input" />
      </div>
      <div class="lal__field">
        <label class="lal__label">retention (min)</label>
        <input v-model.number="retentionMinutes" type="number" min="1" max="60" class="lal__input" />
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

    <p v-if="dbg.error.value" class="lal__error">{{ dbg.error.value }}</p>

    <NodeCoverage
      v-if="dbg.peerAcks.value.length > 0 || (dbg.session.value?.nodes?.length ?? 0) > 0"
      :peer-acks="dbg.peerAcks.value"
      :node-statuses="dbg.session.value?.nodes ?? []"
      :prior-cleanup="dbg.priorCleanup.value"
    />

    <section v-if="dbg.session.value" class="lal__capture">
      <header class="lal__captureh">
        <span class="lal__sid2">session {{ dbg.session.value.sessionId }}</span>
      </header>

      <div v-for="node in nodeViews" :key="node.nodeId ?? node.peer ?? '?'" class="lal__node">
        <header class="lal__nodeh">
          <span class="lal__nodeid">{{ node.nodeId ?? node.peer ?? '?' }}</span>
          <Pill :tone="node.status === 'ok' ? 'ok' : node.status === 'captured' ? 'info' : 'warn'">
            {{ node.status }}
          </Pill>
          <span v-if="node.totalBytes !== undefined" class="lal__bytes">
            {{ node.totalBytes }} bytes
          </span>
        </header>

        <div v-if="node.lalRecords.length === 0" class="lal__nodeempty">
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
            <tr v-for="(rec, idx) in node.lalRecords" :key="`${rec.stage}-${idx}-${rec.capturedAt}`">
              <td class="lal__line">{{ asLal(rec)?.sourceLine ?? '—' }}</td>
              <td class="lal__source"><code>{{ rec.sourceText }}</code></td>
              <td class="lal__kind">
                <Pill :tone="stageTone(rec.stage)">{{ rec.stage }}</Pill>
              </td>
              <td class="lal__result">
                <template v-if="asLal(rec)">
                  <div class="lal__flags">
                    <span v-if="asLal(rec)!.body.aborted" class="lal__flag lal__flag--warn">aborted</span>
                    <span v-if="asLal(rec)!.body.hasOutput" class="lal__flag lal__flag--ok">hasOutput</span>
                    <span v-if="asLal(rec)!.body.hasParsed" class="lal__flag lal__flag--ok">hasParsed</span>
                  </div>
                </template>
              </td>
              <td class="lal__extra">
                <template v-if="asLal(rec)?.body.extra">
                  <div v-if="asLal(rec)!.body.extra!.outputClass" class="lal__extraitem">
                    <span class="lal__lbl">class</span>
                    <code>{{ asLal(rec)!.body.extra!.outputClass }}</code>
                  </div>
                  <div v-if="asLal(rec)!.body.extra!.samples !== undefined" class="lal__extraitem">
                    <span class="lal__lbl">samples</span>
                    {{ asLal(rec)!.body.extra!.samples }}
                  </div>
                </template>
              </td>
              <td class="lal__hash">
                <code>{{ shortHash(rec.contentHash) }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-else-if="dbg.state.value === 'idle'" class="lal__hint">
      pick a LAL rule, set the file (typically <code>{ruleName}.yaml</code>),
      hit start. each captured log record fills one row per probed stage —
      the upstream emits text → parser → extractor → outputRecord /
      outputMetric for kept records.
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

.lal__input--wide {
  width: 200px;
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

.lal__sid2 {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
  font-size: 12px;
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

.lal__bytes {
  margin-left: auto;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.lal__nodeempty {
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

.lal__hint {
  padding: 14px 18px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-size: 12px;
  margin: 0;
}

.lal__hint code {
  font-family: var(--rr-font-mono);
  background: var(--rr-bg);
  padding: 1px 4px;
}
</style>
