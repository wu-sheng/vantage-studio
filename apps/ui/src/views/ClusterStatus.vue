<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->
<script setup lang="ts">
/**
 * Cluster status page — node reachability + DSL-debugging health.
 *
 * Per-rule × per-node convergence used to live here too, but it
 * doubled the cluster page's purpose and overlapped the catalog
 * grid (which already shows status + override badges). Operators
 * who want to find broken rules go to the catalog browse for the
 * relevant DSL; this page stays focused on cluster posture.
 */
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { bff, type ClusterDebugStatus, type PreflightResponse } from '../api/client.js';
import Pill from '../design/primitives/Pill.vue';
import StatusDot from '../design/primitives/StatusDot.vue';
import Btn from '../design/primitives/Btn.vue';

/* Operator-facing poll cadence for the cluster + dsl-debugging
 * panes. Persisted per-browser so an operator who picks 15s once
 * doesn't have to re-pick on every visit. Preflight runs on its own
 * 30s schedule (different concern). */
type PollChoice = 'off' | '5' | '15' | '60';
interface PollOption {
  value: PollChoice;
  label: string;
}
const POLL_OPTIONS: PollOption[] = [
  { value: 'off', label: 'off' },
  { value: '5', label: '5s' },
  { value: '15', label: '15s' },
  { value: '60', label: '60s' },
];
const POLL_KEY = 'vs:cluster:poll:v1';
function loadPoll(): PollChoice {
  try {
    const raw = localStorage.getItem(POLL_KEY);
    if (raw && POLL_OPTIONS.some((o) => o.value === raw)) return raw as PollChoice;
  } catch {
    /* private-browsing / quota — ignore */
  }
  return '5';
}
const pollChoice = ref<PollChoice>(loadPoll());
watch(pollChoice, (next) => {
  try {
    localStorage.setItem(POLL_KEY, next);
  } catch {
    /* ignore */
  }
});
/** Milliseconds for vue-query's `refetchInterval`. `false` disables
 *  the auto-poll (manual mode); any number triggers the next poll
 *  after that many ms. Returned via a function so vue-query re-reads
 *  the ref each tick — flipping the dropdown takes effect immediately
 *  without remounting the query. */
const pollMs = computed<number | false>(() =>
  pollChoice.value === 'off' ? false : Number(pollChoice.value) * 1000,
);
const pollLabel = computed(
  () => POLL_OPTIONS.find((o) => o.value === pollChoice.value)?.label ?? '5s',
);

/** Per-node reachability slice. The rule-matrix payload is unused
 *  here — clusterState() also surfaces `nodes[]` so we keep using
 *  the same fan-out endpoint for consistency. */
const query = useQuery({
  queryKey: ['cluster/state'],
  queryFn: () => bff.clusterState(),
  refetchInterval: () => pollMs.value,
  refetchOnWindowFocus: true,
});

/**
 * SWIP-13 §3.9 — DSL-debugging health snapshot per node.
 * `injectionEnabled: false` means probe call sites were stripped at
 * build/boot — operators see this and know live debugging won't fire
 * regardless of session state. Polled at the same 5 s cadence.
 */
const debugStatusQuery = useQuery({
  queryKey: ['debug/status'],
  queryFn: (): Promise<ClusterDebugStatus> => bff.debugStatus(),
  refetchInterval: () => pollMs.value,
  refetchOnWindowFocus: true,
});

const debugNodes = computed(() => debugStatusQuery.data.value?.nodes ?? []);

/** Preflight — which of Studio's required OAP modules are loaded on
 *  the admin server. Polled at 30s; refresh-now in the header pokes
 *  it on demand. */
const preflightQuery = useQuery<PreflightResponse>({
  queryKey: ['preflight'],
  queryFn: () => bff.preflight(),
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
});

const preflight = computed(() => preflightQuery.data.value ?? null);
const modules = computed(() => preflight.value?.modules ?? []);
const missing = computed(() => modules.value.filter((m) => m.required && !m.enabled));
const adminUnreachable = computed(() => preflight.value !== null && !preflight.value.adminReachable);

function debugStatusBadgeTone(
  ok: boolean,
  injectionEnabled: boolean | undefined,
): 'ok' | 'warn' | 'err' | 'dim' {
  if (!ok) return 'err';
  if (injectionEnabled === false) return 'err';
  return 'ok';
}

const nodes = computed(() => query.data.value?.nodes ?? []);

function nodeLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
</script>

<template>
  <div class="cs">
    <header class="cs__header">
      <h1 class="cs__h1">Cluster status</h1>
      <div class="cs__spacer" />
      <span class="cs__refreshing">
        <StatusDot
          :tone="query.isFetching.value ? 'info' : pollChoice === 'off' ? 'dim' : 'ok'"
          :size="6"
        />
        {{
          query.isFetching.value
            ? 'refreshing…'
            : pollChoice === 'off'
              ? 'manual'
              : `live · ${pollLabel}`
        }}
      </span>
      <label class="cs__pollSelect" title="auto-refresh cadence for cluster + dsl-debugging">
        <select v-model="pollChoice">
          <option v-for="o in POLL_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </label>
      <Btn @click="query.refetch(); preflightQuery.refetch()">refresh now</Btn>
    </header>

    <section class="cs__modules">
      <header class="cs__sectionhead">
        required modules
        <span class="cs__sectionhint">
          OAP-side selectors Studio needs · sourced from
          <code>/debugging/config/dump</code>
        </span>
      </header>

      <div v-if="!preflight" class="cs__placeholder">loading preflight…</div>
      <div v-else-if="adminUnreachable" class="cs__placeholder cs__placeholder--err">
        <StatusDot tone="err" :size="6" />
        OAP admin unreachable at <code>{{ preflight.adminUrl }}</code>.
        <span v-if="preflight.adminError" class="cs__moduleErr">{{ preflight.adminError }}</span>
      </div>

      <table v-else class="cs__modtable">
        <thead>
          <tr>
            <th>module</th>
            <th>state</th>
            <th>env var</th>
            <th>what it gates</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in modules" :key="m.name" :class="{ 'cs__modrow--off': !m.enabled }">
            <td class="cs__modname"><code>{{ m.name }}</code></td>
            <td>
              <Pill :tone="m.enabled ? 'ok' : 'err'">
                {{ m.enabled ? 'enabled' : 'missing' }}
              </Pill>
            </td>
            <td class="cs__modenv">
              <code v-if="m.enabled">{{ m.envVar }}=default</code>
              <code v-else class="cs__modenv--missing">{{ m.envVar }}=default</code>
            </td>
            <td class="cs__modaffects">{{ m.affects }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="missing.length > 0" class="cs__modulesHint">
        Set the env var{{ missing.length === 1 ? '' : 's' }} above on the OAP container and
        restart. Studio recovers on the next poll without a re-login.
      </p>
    </section>

    <section class="cs__nodes">
      <header class="cs__sectionhead">nodes</header>
      <ul class="cs__nodeList">
        <li v-for="n in nodes" :key="n.url" class="cs__node" :class="{ 'cs__node--err': !n.ok }">
          <StatusDot :tone="n.ok ? 'ok' : 'err'" />
          <span class="cs__nodeUrl">{{ nodeLabel(n.url) }}</span>
          <span v-if="n.error" class="cs__nodeErr" :title="n.error">{{ n.error }}</span>
        </li>
      </ul>
    </section>

    <section class="cs__debug">
      <header class="cs__sectionhead">
        dsl-debugging
        <span class="cs__sectionhint">
          probe injection · session pressure · per node
        </span>
      </header>

      <div v-if="debugStatusQuery.isPending.value" class="cs__placeholder">loading…</div>
      <div v-else-if="debugStatusQuery.isError.value" class="cs__placeholder cs__placeholder--err">
        Could not load /api/debug/status.
        <Btn @click="debugStatusQuery.refetch()">retry</Btn>
      </div>
      <div v-else-if="debugNodes.length === 0" class="cs__placeholder">
        No admin URLs configured.
      </div>

      <table v-else class="cs__dbgtable">
        <thead>
          <tr>
            <th>node</th>
            <th>health</th>
            <th>injection</th>
            <th>active sessions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in debugNodes" :key="n.url">
            <td class="cs__dbgnode">{{ nodeLabel(n.url) }}</td>
            <td>
              <Pill
                :tone="debugStatusBadgeTone(n.ok, n.status?.injectionEnabled)"
              >
                {{ n.ok ? 'reachable' : 'unreachable' }}
              </Pill>
              <span v-if="!n.ok && n.error" class="cs__dbgerr" :title="n.error">{{ n.error }}</span>
            </td>
            <td>
              <Pill v-if="!n.ok" tone="dim">—</Pill>
              <Pill v-else-if="n.status?.injectionEnabled" tone="ok">enabled</Pill>
              <Pill v-else tone="err">disabled</Pill>
            </td>
            <td class="cs__dbgnum">
              <template v-if="n.ok && n.status">
                {{ n.status.activeSessions }}
              </template>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

  </div>
</template>

<style scoped>
.cs__sectionhint {
  margin-left: 8px;
  font-family: var(--rr-font-sans);
  font-weight: 400;
  font-size: 14.5px;
  color: var(--rr-dim);
  text-transform: none;
  letter-spacing: 0;
}

.cs__debug {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cs__dbgtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 15.5px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
}

.cs__dbgtable th,
.cs__dbgtable td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--rr-border);
}

.cs__dbgtable th {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.cs__dbgnode {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
}

.cs__dbgnum {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink);
}

.cs__dbgmax {
  color: var(--rr-dim);
  margin-left: 2px;
}

.cs__dbgerr {
  margin-left: 8px;
  color: var(--rr-dim);
  font-style: italic;
  font-size: 14.5px;
}

.cs__modules {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cs__modtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 15.5px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
}
.cs__modtable th,
.cs__modtable td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--rr-border);
}
.cs__modtable th {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}
.cs__modname code {
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-heading);
}
.cs__modenv code {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-ink2);
}
.cs__modenv--missing { color: var(--rr-err) !important; }
.cs__modaffects {
  color: var(--rr-ink2);
  font-size: 13.5px;
  line-height: 1.55;
}
.cs__modrow--off { background: color-mix(in oklab, var(--rr-err) 8%, transparent); }
.cs__modulesHint {
  margin: 6px 0 0;
  font-family: var(--rr-font-mono);
  font-size: 12.5px;
  color: var(--rr-dim);
}
.cs__moduleErr {
  margin-left: 8px;
  font-style: italic;
  color: var(--rr-dim);
}

.cs {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1600px;
}

.cs__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cs__h1 {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  font-size: 18px;
  color: var(--rr-heading);
}

.cs__spacer {
  flex: 1 1 auto;
}

.cs__pollSelect select {
  font-family: var(--rr-font-mono);
  font-size: 13px;
  padding: 3px 8px;
  background: var(--rr-bg2);
  color: var(--rr-ink);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-sm);
  cursor: pointer;
}
.cs__pollSelect select:hover {
  border-color: var(--rr-border2);
  color: var(--rr-heading);
}

.cs__refreshing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-dim);
}

.cs__sectionhead {
  display: flex;
  align-items: center;
  font-family: var(--rr-font-mono);
  font-size: 14px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
  padding-bottom: 4px;
  margin-bottom: 8px;
}

.cs__nodeList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.cs__node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-md);
  font-family: var(--rr-font-mono);
  font-size: 15px;
}

.cs__node--err {
  border-color: var(--rr-err);
}

.cs__nodeUrl {
  color: var(--rr-heading);
}

.cs__nodeErr {
  color: var(--rr-err);
  font-size: 14px;
}

.cs__placeholder {
  padding: 24px;
  font-family: var(--rr-font-mono);
  font-size: 15.5px;
  color: var(--rr-dim);
  text-align: center;
}

.cs__placeholder--err {
  color: var(--rr-err);
}
</style>
