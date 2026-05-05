<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0
-->
<script setup lang="ts">
/**
 * Source pane sidecar for the live debugger.
 *
 * Renders the rule's source body (line-numbered, monospace) alongside
 * the captured-record waterfall. The parent view passes a 1-based
 * `highlightedLines` set: those lines render in bold with a left
 * accent stripe, and the first highlighted line scrolls into view.
 *
 * Hot-update awareness: `pageHash` is the most recent captured
 * record's contentHash; if it differs from the loaded source's
 * contentHash, the pane shows a stale-content banner so the operator
 * knows the source on the right is from a different version of the
 * rule. Operator clicks Refresh to re-fetch.
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { RuleSource } from '../../composables/useRuleSource.js';
import Btn from '../../design/primitives/Btn.vue';
import Pill from '../../design/primitives/Pill.vue';

const props = defineProps<{
  /** Loaded source body. Null while loading / unsupported. */
  source: RuleSource | null;
  /** True while the underlying vue-query is in flight. */
  loading: boolean;
  /** Set when the source fetch failed. */
  error: string | null;
  /** 1-based line numbers to highlight. Empty = no rows hovered. */
  highlightedLines: readonly number[];
  /** SHA-256 from the most recent captured record. When non-empty
   *  and different from `source.contentHash` we surface the stale-
   *  source banner. */
  pageHash: string | null;
}>();

const emit = defineEmits<{
  refetch: [];
}>();

const highlights = computed<Set<number>>(() => new Set(props.highlightedLines));

const stale = computed<boolean>(() => {
  if (!props.source || !props.pageHash) return false;
  return props.pageHash !== props.source.contentHash;
});

interface RenderedLine {
  num: number;
  text: string;
  highlighted: boolean;
}

const renderedLines = computed<RenderedLine[]>(() => {
  const src = props.source;
  if (!src) return [];
  const set = highlights.value;
  return src.lines.map((text, i) => {
    const num = i + 1;
    return { num, text, highlighted: set.has(num) };
  });
});

/** Scroll the first highlighted line into view when the highlight
 *  set changes. Uses a per-line ref map keyed by line number. */
const lineRefs = ref<Map<number, HTMLElement>>(new Map());
function setLineRef(n: number, el: Element | null): void {
  if (el instanceof HTMLElement) lineRefs.value.set(n, el);
  else lineRefs.value.delete(n);
}

watch(
  () => props.highlightedLines,
  async (lines) => {
    if (lines.length === 0) return;
    await nextTick();
    const el = lineRefs.value.get(lines[0]!);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
);

function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.slice(0, 8);
}
</script>

<template>
  <aside class="src">
    <header class="src__header">
      <span class="src__title">source</span>
      <template v-if="source">
        <span class="src__rule">
          {{ source.catalog }} · {{ source.name }}
        </span>
        <Pill :tone="source.source === 'runtime' ? 'info' : 'dim'">{{ source.source }}</Pill>
        <code class="src__hash">{{ shortHash(source.contentHash) }}</code>
      </template>
    </header>

    <div v-if="stale" class="src__stale">
      <span>
        captures arriving under hash <code>{{ shortHash(pageHash) }}</code> —
        loaded source is <code>{{ shortHash(source?.contentHash) }}</code>.
        rule was hot-updated mid-session.
      </span>
      <Btn kind="ghost" size="sm" @click="emit('refetch')">refetch</Btn>
    </div>

    <div v-if="loading" class="src__placeholder">loading source…</div>
    <div v-else-if="error" class="src__placeholder src__placeholder--err">
      {{ error }}
      <Btn kind="ghost" size="sm" @click="emit('refetch')">retry</Btn>
    </div>
    <div v-else-if="!source" class="src__placeholder">
      no source loaded
    </div>

    <pre v-else class="src__body">
      <span
        v-for="line in renderedLines"
        :key="line.num"
        :ref="(el) => setLineRef(line.num, el as Element | null)"
        class="src__line"
        :class="{ 'src__line--hl': line.highlighted }"
      ><span class="src__num">{{ line.num }}</span><span class="src__text">{{ line.text }}</span></span>
    </pre>
  </aside>
</template>

<style scoped>
.src {
  display: flex;
  flex-direction: column;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  min-height: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

.src__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg3);
  border-bottom: 1px solid var(--rr-border);
  flex-wrap: wrap;
}

.src__title {
  font-family: var(--rr-font-mono);
  font-size: 9.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.src__rule {
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-heading);
}

.src__hash {
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  color: var(--rr-dim);
  margin-left: auto;
}

.src__stale {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--rr-bg);
  color: var(--rr-warn, #d4a93b);
  border-bottom: 1px solid var(--rr-border);
  font-size: 11.5px;
}

.src__stale code {
  font-family: var(--rr-font-mono);
  color: var(--rr-ink);
  margin: 0 2px;
}

.src__placeholder {
  padding: 14px;
  font-size: 12px;
  color: var(--rr-dim);
  font-style: italic;
}

.src__placeholder--err {
  color: var(--rr-err, #f44);
}

.src__body {
  flex: 1 1 auto;
  margin: 0;
  padding: 0;
  overflow: auto;
  font-family: var(--rr-font-mono);
  font-size: 11.5px;
  color: var(--rr-ink2);
  /* Allow long lines to extend horizontally rather than wrap — the
     line-number gutter relies on one DOM line == one source line. */
  white-space: pre;
}

.src__line {
  display: flex;
  align-items: baseline;
  padding: 0 6px;
  border-left: 2px solid transparent;
  min-height: 1.4em;
  white-space: pre;
}

.src__line--hl {
  background: var(--rr-bg3);
  color: var(--rr-heading);
  border-left-color: var(--rr-active);
  font-weight: 500;
}

.src__num {
  display: inline-block;
  width: 36px;
  text-align: right;
  margin-right: 10px;
  color: var(--rr-dim);
  user-select: none;
  flex-shrink: 0;
}

.src__line--hl .src__num {
  color: var(--rr-active);
}

.src__text {
  display: inline-block;
  white-space: pre;
}
</style>
