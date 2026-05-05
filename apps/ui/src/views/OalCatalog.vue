<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * OAL catalog browse — reflects the actual upstream wire shape:
 *
 *   /runtime/oal/files          → bare file-name list
 *   /runtime/oal/files/{name}   → raw `.oal` text (text/plain)
 *   /runtime/oal/rules          → per-dispatcher listing
 *   /runtime/oal/rules/{source} → single-source detail
 *
 * Two panes:
 *   - left: file list (just names) with on-click reveal of the
 *     raw `.oal` text fetched on demand.
 *   - right: source / dispatcher table — the same data the OAL
 *     debugger's source picker consumes, plus the live/no_holder
 *     status from the per-source detail call.
 */
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { OalSourceListing } from '@vantage-studio/api-client';
import { bff } from '../api/client.js';
import Pill from '../design/primitives/Pill.vue';

const selectedFile = ref<string | null>(null);
const fileContent = ref<string | null>(null);
const fileLoading = ref(false);
const fileError = ref<string | null>(null);

const filesQuery = useQuery({
  queryKey: ['oal/files'],
  queryFn: async () => bff.oalFiles(),
});

const sourcesQuery = useQuery({
  queryKey: ['oal/rules'],
  queryFn: async () => bff.oalSources(),
});

const files = computed<string[]>(() => filesQuery.data.value?.files ?? []);
const sources = computed<OalSourceListing[]>(() => sourcesQuery.data.value?.sources ?? []);

watch(
  () => selectedFile.value,
  async (name) => {
    fileContent.value = null;
    fileError.value = null;
    if (!name) return;
    fileLoading.value = true;
    try {
      fileContent.value = await bff.oalFileContent(name);
      if (fileContent.value === null) fileError.value = 'file not found';
    } catch (err) {
      fileError.value = err instanceof Error ? err.message : String(err);
    } finally {
      fileLoading.value = false;
    }
  },
);

// Auto-select the first file when the listing loads.
watch(
  () => files.value,
  (list) => {
    if (selectedFile.value === null && list.length > 0) {
      selectedFile.value = list[0]!;
    }
  },
);
</script>

<template>
  <div class="oal">
    <header class="oal__header">
      <h1 class="oal__h1">OAL catalog</h1>
      <Pill tone="dim">read-only</Pill>
      <span class="oal__hint">
        OAL hot-update is upstream-deferred. Studio surfaces the loaded
        files + the per-source dispatcher set the live debugger picks
        from.
      </span>
    </header>

    <div class="oal__grid">
      <!-- Files pane ─────────────────────────────────────────── -->
      <section class="oal__pane">
        <header class="oal__paneh">
          files
          <span class="oal__panecount">
            {{ files.length }}
          </span>
        </header>

        <div v-if="filesQuery.isPending.value" class="oal__loading">loading…</div>
        <div v-else-if="filesQuery.isError.value" class="oal__error">
          Could not load OAL files.
          <button type="button" @click="filesQuery.refetch()">retry</button>
        </div>
        <div v-else-if="files.length === 0" class="oal__empty">
          no `.oal` files loaded
        </div>
        <div v-else class="oal__filelistwrap">
          <ul class="oal__filelist">
            <li v-for="f in files" :key="f">
              <button
                type="button"
                class="oal__fileitem"
                :class="{ 'oal__fileitem--active': selectedFile === f }"
                @click="selectedFile = f"
              >
                <code>{{ f }}</code>
              </button>
            </li>
          </ul>

          <div class="oal__filedetail">
            <header v-if="selectedFile" class="oal__filehead">
              <code>{{ selectedFile }}</code>
            </header>
            <div v-if="fileLoading" class="oal__loading">loading…</div>
            <div v-else-if="fileError" class="oal__error">{{ fileError }}</div>
            <pre v-else-if="fileContent !== null" class="oal__filepre">{{ fileContent }}</pre>
          </div>
        </div>
      </section>

      <!-- Sources pane ───────────────────────────────────────── -->
      <section class="oal__pane">
        <header class="oal__paneh">
          sources / dispatchers
          <span class="oal__panecount">
            {{ sources.length }}
          </span>
        </header>

        <div v-if="sourcesQuery.isPending.value" class="oal__loading">loading…</div>
        <div v-else-if="sourcesQuery.isError.value" class="oal__error">
          Could not load OAL sources.
          <button type="button" @click="sourcesQuery.refetch()">retry</button>
        </div>
        <div v-else-if="sources.length === 0" class="oal__empty">
          no OAL dispatchers registered
        </div>
        <table v-else class="oal__sources">
          <thead>
            <tr>
              <th>source</th>
              <th>dispatcher</th>
              <th>metrics</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="src in sources" :key="src.source">
              <td class="oal__srcname"><code>{{ src.source }}</code></td>
              <td class="oal__dispatcher" :title="src.dispatcher">
                <code>{{ src.dispatcher }}</code>
              </td>
              <td class="oal__srcmetrics">
                <span v-for="m in src.metrics" :key="m" class="oal__metric">{{ m }}</span>
              </td>
            </tr>
          </tbody>
        </table>
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

.oal__grid {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.4fr);
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.oal__pane {
  display: flex;
  flex-direction: column;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  overflow: hidden;
  min-height: 0;
}

.oal__paneh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
  border-bottom: 1px solid var(--rr-border);
}

.oal__panecount {
  color: var(--rr-ink2);
  letter-spacing: 0.4px;
}

.oal__loading,
.oal__empty,
.oal__error {
  padding: 14px;
  font-size: 12px;
  color: var(--rr-dim);
}

.oal__error {
  color: var(--rr-err, #f44);
}

.oal__filelistwrap {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
}

.oal__filelist {
  list-style: none;
  margin: 0;
  padding: 0;
  border-right: 1px solid var(--rr-border);
  overflow-y: auto;
}

.oal__fileitem {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-ink);
}

.oal__fileitem code {
  font-family: var(--rr-font-mono);
}

.oal__fileitem:hover {
  background: var(--rr-bg3);
}

.oal__fileitem--active {
  background: var(--rr-bg3);
  border-left-color: var(--rr-active);
}

.oal__filedetail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.oal__filehead {
  padding: 6px 12px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-heading);
  border-bottom: 1px solid var(--rr-border);
  flex-shrink: 0;
}

.oal__filepre {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  flex: 1 1 auto;
}

.oal__sources {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.oal__sources th,
.oal__sources td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--rr-border);
  text-align: left;
  vertical-align: top;
}

.oal__sources th {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.oal__srcname {
  width: 130px;
  font-family: var(--rr-font-mono);
  color: var(--rr-heading);
}

.oal__dispatcher {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  font-size: 11px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oal__srcmetrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 4px;
}

.oal__metric {
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
  padding: 1px 6px;
  background: var(--rr-bg);
}
</style>
