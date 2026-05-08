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
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { bff, type ClusterDebugStatus } from '../api/client.js';
import Pill from '../design/primitives/Pill.vue';
import StatusDot from '../design/primitives/StatusDot.vue';
import Btn from '../design/primitives/Btn.vue';

/** Per-node reachability slice. The rule-matrix payload is unused
 *  here — clusterState() also surfaces `nodes[]` so we keep using
 *  the same fan-out endpoint for consistency. */
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
 * regardless of session state. Polled at the same 5 s cadence.
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
            <th>active sessions</th>
            <th>module / phase</th>
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
            <td class="cs__dbgsource">
              <code v-if="n.ok && n.status">{{ n.status.module }} · {{ n.status.phase }}</code>
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

.cs__dbgsource code {
  font-family: var(--rr-font-mono);
  font-size: 14.5px;
  color: var(--rr-ink2);
}

.cs__dbgerr {
  margin-left: 8px;
  color: var(--rr-dim);
  font-style: italic;
  font-size: 14.5px;
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
