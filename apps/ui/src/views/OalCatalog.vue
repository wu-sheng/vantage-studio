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
 * OAL catalog browse — read-only view of every `.oal` file the OAP
 * cluster has loaded plus every rule line within each file. Backed by
 * SWIP-13 §4.1's `/runtime/oal/{files,rules}` endpoints; OAL
 * hot-update is intentionally not in scope here.
 *
 * Layout:
 *   left  · list of files ($name, $ruleCount, $status, $contentHash short)
 *   right · selected file's rules table — ruleName, scope, function,
 *           filters[], persistedMetricName, contentHash short
 *
 * `contentHash` is rendered prominently because it's the same SHA-256
 * the live debugger stamps on captured records — operators see the
 * version identity without needing the debugger open.
 */
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { OalFileDetail, OalFileListing, OalRuleSnapshot } from '@vantage-studio/api-client';
import { bff } from '../api/client.js';
import Pill from '../design/primitives/Pill.vue';

const selectedFile = ref<string | null>(null);

const filesQuery = useQuery({
  queryKey: ['oal/files'],
  queryFn: async (): Promise<OalFileListing[]> => bff.oalFiles(),
});

const fileDetailQuery = useQuery({
  queryKey: computed(() => ['oal/file', selectedFile.value]),
  queryFn: async (): Promise<OalFileDetail | null> =>
    selectedFile.value ? bff.oalFile(selectedFile.value) : null,
  enabled: computed(() => selectedFile.value !== null),
});

const files = computed<OalFileListing[]>(() => filesQuery.data.value ?? []);
const detail = computed<OalFileDetail | null>(() => fileDetailQuery.data.value ?? null);

function selectFile(name: string): void {
  selectedFile.value = name;
}

function shortHash(hash: string): string {
  if (!hash) return '—';
  return hash.slice(0, 8);
}

function fileStatusTone(status: OalFileListing['status']): 'ok' | 'warn' | 'err' {
  switch (status) {
    case 'LOADED':
      return 'ok';
    case 'DISABLED':
      return 'warn';
    case 'COMPILE_FAILED':
      return 'err';
  }
}

function describeFilters(rule: OalRuleSnapshot): string {
  if (rule.filters.length === 0) return '—';
  return rule.filters.map((f) => `${f.left} ${f.op} ${f.right}`).join(' & ');
}

// Auto-select the first file when the list loads.
const _autoSelect = computed(() => {
  if (selectedFile.value === null && files.value.length > 0) {
    selectedFile.value = files.value[0]!.name;
  }
  return null;
});
void _autoSelect;
</script>

<template>
  <div class="oal">
    <header class="oal__header">
      <h1 class="oal__h1">OAL catalog</h1>
      <Pill tone="dim">read-only</Pill>
      <span class="oal__hint">
        OAL hot-update is upstream-deferred. Studio surfaces what the
        cluster has loaded; live changes ship in a future release.
      </span>
    </header>

    <div v-if="filesQuery.isPending.value" class="oal__loading">loading…</div>

    <div v-else-if="filesQuery.isError.value" class="oal__error">
      Could not load OAL catalog.
      <button type="button" @click="filesQuery.refetch()">retry</button>
    </div>

    <div v-else-if="files.length === 0" class="oal__empty">
      No `.oal` files loaded on the OAP cluster.
    </div>

    <div v-else class="oal__split">
      <aside class="oal__files">
        <header class="oal__sidebarhead">files · {{ files.length }}</header>
        <ul class="oal__filelist">
          <li v-for="f in files" :key="f.name">
            <button
              type="button"
              class="oal__fileitem"
              :class="{ 'oal__fileitem--active': selectedFile === f.name }"
              @click="selectFile(f.name)"
            >
              <span class="oal__filename">{{ f.name }}</span>
              <span class="oal__filemeta">
                <Pill :tone="fileStatusTone(f.status)">{{ f.status.toLowerCase() }}</Pill>
                <span class="oal__rulecount">{{ f.ruleCount }} rules</span>
                <code class="oal__hash">{{ shortHash(f.contentHash) }}</code>
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <section class="oal__detail">
        <div v-if="!selectedFile" class="oal__placeholder">Pick a file.</div>

        <div v-else-if="fileDetailQuery.isPending.value" class="oal__loading">loading…</div>

        <div v-else-if="fileDetailQuery.isError.value" class="oal__error">
          Could not load <code>{{ selectedFile }}</code>.
          <button type="button" @click="fileDetailQuery.refetch()">retry</button>
        </div>

        <template v-else-if="detail">
          <header class="oal__detailhead">
            <div class="oal__title">
              <h2 class="oal__h2">{{ detail.name }}</h2>
              <code class="oal__path">{{ detail.path }}</code>
            </div>
            <div class="oal__detailmeta">
              <Pill :tone="fileStatusTone(detail.status)">{{ detail.status.toLowerCase() }}</Pill>
              <span class="oal__hashfull">
                contentHash <code>{{ detail.contentHash || '—' }}</code>
              </span>
            </div>
          </header>

          <table class="oal__rules">
            <thead>
              <tr>
                <th>line</th>
                <th>rule</th>
                <th>scope</th>
                <th>fn</th>
                <th>filters</th>
                <th>persisted metric</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in detail.rules" :key="r.ruleName">
                <td class="oal__line">{{ r.line }}</td>
                <td class="oal__rulename">{{ r.ruleName }}</td>
                <td class="oal__scope">{{ r.sourceScope }}</td>
                <td class="oal__fn"><code>{{ r.function }}</code></td>
                <td class="oal__filters">{{ describeFilters(r) }}</td>
                <td class="oal__persisted">{{ r.persistedMetricName }}</td>
              </tr>
            </tbody>
          </table>

          <details class="oal__source">
            <summary>raw <code>.oal</code> text</summary>
            <pre class="oal__sourcepre">{{ detail.content }}</pre>
          </details>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.oal {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 24px;
  font-family: var(--rr-font-sans);
  color: var(--rr-ink);
  height: 100%;
  min-height: 0;
}

.oal__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.oal__h1 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--rr-heading);
}

.oal__hint {
  font-size: 11.5px;
  color: var(--rr-dim);
}

.oal__loading,
.oal__error,
.oal__empty,
.oal__placeholder {
  padding: 12px 16px;
  font-size: 12px;
  color: var(--rr-dim);
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
}

.oal__error button {
  margin-left: 8px;
}

.oal__split {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.oal__files {
  display: flex;
  flex-direction: column;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  overflow: hidden;
}

.oal__sidebarhead {
  padding: 8px 12px;
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
}

.oal__filelist {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.oal__fileitem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--rr-font-sans);
  font-size: 12px;
  color: var(--rr-ink);
}

.oal__fileitem:hover {
  background: var(--rr-bg3);
}

.oal__fileitem--active {
  background: var(--rr-bg3);
  border-left-color: var(--rr-active);
}

.oal__filename {
  font-weight: 500;
}

.oal__filemeta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: var(--rr-dim);
}

.oal__rulecount {
  font-family: var(--rr-font-mono);
}

.oal__hash {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
}

.oal__detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  padding: 12px 16px;
  overflow: auto;
  min-height: 0;
}

.oal__detailhead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.oal__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.oal__h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--rr-heading);
}

.oal__path {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__detailmeta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--rr-dim);
}

.oal__hashfull code {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  margin-left: 4px;
  word-break: break-all;
}

.oal__rules {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.oal__rules th,
.oal__rules td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--rr-border);
  text-align: left;
  vertical-align: top;
}

.oal__rules th {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.oal__line {
  font-family: var(--rr-font-mono);
  color: var(--rr-dim);
  width: 50px;
}

.oal__rulename {
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
}

.oal__filters {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  font-size: 11.5px;
}

.oal__persisted {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  font-size: 11.5px;
}

.oal__source {
  margin-top: 10px;
  font-size: 11.5px;
}

.oal__source summary {
  cursor: pointer;
  color: var(--rr-dim);
  padding: 4px 0;
}

.oal__sourcepre {
  margin: 6px 0 0;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
</style>
