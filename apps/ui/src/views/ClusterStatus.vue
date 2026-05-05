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
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { bff, type ClusterDebugStatus, type ClusterRule } from '../api/client.js';
import Pill from '../design/primitives/Pill.vue';
import StatusDot from '../design/primitives/StatusDot.vue';
import Btn from '../design/primitives/Btn.vue';

const query = useQuery({
  queryKey: ['cluster/state'],
  queryFn: () => bff.clusterState(),
  refetchInterval: 5_000,
  refetchOnWindowFocus: true,
});

/**
 * SWIP-13 §3.9 — DSL-debugging health snapshot per node.
 * `injectionEnabled: false` means probe call sites were stripped at
 * build/boot — operators see this and know live debugging won't fire
 * regardless of session state. Polled at the same 5 s cadence as the
 * rules matrix.
 */
const debugStatusQuery = useQuery({
  queryKey: ['debug/status'],
  queryFn: (): Promise<ClusterDebugStatus> => bff.debugStatus(),
  refetchInterval: 5_000,
  refetchOnWindowFocus: true,
});

const debugNodes = computed(() => debugStatusQuery.data.value?.nodes ?? []);

function debugStatusBadgeTone(
  ok: boolean,
  injectionEnabled: boolean | undefined,
  acceptingNew: boolean | undefined,
): 'ok' | 'warn' | 'err' | 'dim' {
  if (!ok) return 'err';
  if (injectionEnabled === false) return 'err';
  if (acceptingNew === false) return 'warn';
  return 'ok';
}

type SortKey = 'name' | 'state' | 'converged';
const sortKey = ref<SortKey>('state');

const nodes = computed(() => query.data.value?.nodes ?? []);
const rules = computed<ClusterRule[]>(() => query.data.value?.rules ?? []);

const sorted = computed<ClusterRule[]>(() => {
  const list = [...rules.value];
  switch (sortKey.value) {
    case 'name':
      list.sort((a, b) => `${a.catalog}/${a.name}`.localeCompare(`${b.catalog}/${b.name}`));
      break;
    case 'state':
      // Diverged + has-error first, then converged, sub-sort by name.
      list.sort((a, b) => {
        const aErr = ruleHasError(a) ? 0 : 1;
        const bErr = ruleHasError(b) ? 0 : 1;
        if (aErr !== bErr) return aErr - bErr;
        if (a.converged !== b.converged) return a.converged ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      break;
    case 'converged':
      list.sort((a, b) => {
        if (a.converged !== b.converged) return a.converged ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      break;
  }
  return list;
});

const totals = computed(() => {
  const total = rules.value.length;
  const converged = rules.value.filter((r) => r.converged).length;
  const errors = rules.value.filter((r) => ruleHasError(r)).length;
  return { total, converged, errors };
});

function ruleHasError(r: ClusterRule): boolean {
  return Object.values(r.perNode).some((p) => p?.lastApplyError);
}

function statusTone(value: string | null | undefined): 'ok' | 'warn' | 'dim' | 'err' {
  switch (value) {
    case 'ACTIVE':
      return 'ok';
    case 'INACTIVE':
      return 'warn';
    case 'BUNDLED':
      return 'dim';
    case 'n/a':
      return 'err';
    default:
      return 'dim';
  }
}

function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.slice(0, 7);
}

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
      <Pill v-if="totals.total > 0" tone="dim">{{ totals.total }} rules</Pill>
      <Pill v-if="totals.errors > 0" tone="err">{{ totals.errors }} with errors</Pill>
      <Pill v-if="totals.total > 0 && totals.converged !== totals.total" tone="warn">
        {{ totals.total - totals.converged }} diverged
      </Pill>
      <div class="cs__spacer" />
      <span class="cs__refreshing">
        <StatusDot :tone="query.isFetching.value ? 'info' : 'ok'" :size="6" />
        {{ query.isFetching.value ? 'refreshing…' : 'live · 5s' }}
      </span>
      <Btn @click="query.refetch()">refresh now</Btn>
    </header>

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
            <th>accepting new</th>
            <th>active</th>
            <th>probes</th>
            <th>injection source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in debugNodes" :key="n.url">
            <td class="cs__dbgnode">{{ nodeLabel(n.url) }}</td>
            <td>
              <Pill
                :tone="debugStatusBadgeTone(n.ok, n.status?.injectionEnabled, n.status?.sessionsAcceptingNewRequests)"
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
            <td>
              <Pill v-if="!n.ok" tone="dim">—</Pill>
              <Pill v-else-if="n.status?.sessionsAcceptingNewRequests" tone="ok">yes</Pill>
              <Pill v-else tone="warn">no</Pill>
            </td>
            <td class="cs__dbgnum">
              <template v-if="n.ok && n.status">
                {{ n.status.activeSessions }}
                <span class="cs__dbgmax">/ {{ n.status.maxActiveSessions }}</span>
              </template>
              <span v-else>—</span>
            </td>
            <td class="cs__dbgnum">
              <template v-if="n.ok && n.status">
                {{ n.status.ruleClassesWithProbes }}
                <span class="cs__dbgmax">/ {{ n.status.ruleClassesTotal }}</span>
              </template>
              <span v-else>—</span>
            </td>
            <td class="cs__dbgsource">
              <code v-if="n.ok && n.status?.injectionEnabledSource">{{ n.status.injectionEnabledSource }}</code>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="cs__matrix">
      <header class="cs__sectionhead">
        rules
        <div class="cs__sortgroup">
          <button
            class="cs__sortbtn"
            :class="{ 'cs__sortbtn--active': sortKey === 'state' }"
            @click="sortKey = 'state'"
          >
            by state
          </button>
          <button
            class="cs__sortbtn"
            :class="{ 'cs__sortbtn--active': sortKey === 'converged' }"
            @click="sortKey = 'converged'"
          >
            by convergence
          </button>
          <button
            class="cs__sortbtn"
            :class="{ 'cs__sortbtn--active': sortKey === 'name' }"
            @click="sortKey = 'name'"
          >
            by name
          </button>
        </div>
      </header>

      <div v-if="query.isPending.value" class="cs__placeholder">loading…</div>
      <div v-else-if="query.isError.value" class="cs__placeholder cs__placeholder--err">
        Could not load cluster state.
        <Btn @click="query.refetch()">retry</Btn>
      </div>
      <div v-else-if="sorted.length === 0" class="cs__placeholder">
        No rules in the cluster.
      </div>

      <table v-else class="cs__table">
        <thead>
          <tr>
            <th class="cs__col cs__col--rule">rule</th>
            <th v-for="n in nodes" :key="n.url" class="cs__col cs__col--node">
              {{ nodeLabel(n.url) }}
            </th>
            <th class="cs__col cs__col--converged">converged</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sorted" :key="`${r.catalog}/${r.name}`">
            <td class="cs__cell cs__cell--rule">
              <span class="cs__catalog">{{ r.catalog }}</span>
              <span class="cs__sep">/</span>
              <span class="cs__name">{{ r.name }}</span>
            </td>
            <td v-for="n in nodes" :key="n.url" class="cs__cell">
              <template v-if="r.perNode[n.url]">
                <Pill :tone="statusTone(r.perNode[n.url]!.status)">
                  {{ r.perNode[n.url]!.status ?? 'n/a' }}
                </Pill>
                <span class="cs__hash">{{ shortHash(r.perNode[n.url]!.contentHash) }}</span>
                <Pill v-if="r.perNode[n.url]!.localState === 'SUSPENDED'" tone="warn">
                  suspended
                </Pill>
                <span
                  v-if="r.perNode[n.url]!.lastApplyError"
                  class="cs__cellerr"
                  :title="r.perNode[n.url]!.lastApplyError"
                >
                  err
                </span>
              </template>
              <span v-else class="cs__missing">—</span>
            </td>
            <td class="cs__cell cs__cell--converged">
              <Pill :tone="r.converged ? 'ok' : 'warn'">
                {{ r.converged ? 'yes' : 'no' }}
              </Pill>
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
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 9.5px;
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

.cs__dbgsource code {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
}

.cs__dbgerr {
  margin-left: 8px;
  color: var(--rr-dim);
  font-style: italic;
  font-size: 11px;
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

.cs__refreshing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.cs__sectionhead {
  display: flex;
  align-items: center;
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
  padding-bottom: 4px;
  margin-bottom: 8px;
}

.cs__sortgroup {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

.cs__sortbtn {
  background: transparent;
  border: 1px solid var(--rr-border);
  color: var(--rr-dim);
  font-family: var(--rr-font-mono);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: var(--rr-radius-md);
}
.cs__sortbtn:hover {
  color: var(--rr-ink2);
}
.cs__sortbtn--active {
  background: var(--rr-bg2);
  color: var(--rr-active);
  border-color: var(--rr-active);
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
  font-size: 11.5px;
}

.cs__node--err {
  border-color: var(--rr-err);
}

.cs__nodeUrl {
  color: var(--rr-heading);
}

.cs__nodeErr {
  color: var(--rr-err);
  font-size: 10.5px;
}

.cs__placeholder {
  padding: 24px;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-dim);
  text-align: center;
}

.cs__placeholder--err {
  color: var(--rr-err);
}

.cs__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--rr-font-mono);
}

.cs__table th,
.cs__table td {
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--rr-border);
}

.cs__col {
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rr-dim);
  font-weight: 500;
}

.cs__cell--rule {
  white-space: nowrap;
}

.cs__catalog {
  color: var(--rr-dim);
}

.cs__sep {
  color: var(--rr-border2);
  margin: 0 2px;
}

.cs__name {
  color: var(--rr-heading);
}

.cs__cell {
  display: table-cell;
}

.cs__cell .pill,
.cs__cell .pill + .pill {
  margin-right: 4px;
}

.cs__hash {
  margin-left: 6px;
  color: var(--rr-dim);
  letter-spacing: 0.4px;
}

.cs__cellerr {
  margin-left: 6px;
  color: var(--rr-err);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: help;
}

.cs__missing {
  color: var(--rr-dim);
}
</style>
