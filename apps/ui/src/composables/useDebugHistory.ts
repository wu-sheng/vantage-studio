/*
 * Copyright 2026 The Vantage Studio Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Browser-local history of past debug captures, shared across the
 * three live-debugger views (MAL / LAL / OAL).
 *
 * Each session that finishes capture is auto-saved here so the
 * operator can re-open it later without re-running OAP. The store
 * lives entirely in `localStorage` under one key — no BFF round-trip,
 * survives reloads, capped at MAX_ENTRIES (oldest dropped on overflow
 * or quota error).
 *
 * The composable returns a `widget`-filtered reactive list plus
 * mutators. The underlying cache is a singleton ref so multiple
 * mounts share state without hitting localStorage repeatedly.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { SessionResponse } from '@vantage-studio/api-client';

export type DebugWidget = 'mal' | 'lal' | 'oal';

export interface HistoryEntry {
  /** Stable id; survives serialization. */
  id: string;
  /** Unix-ms when the capture was archived (not when it ran). */
  savedAt: number;
  widget: DebugWidget;
  catalog: string;
  name: string;
  ruleName: string;
  granularity?: string;
  recordCap?: number;
  retentionMillis?: number;
  /** Counts surfaced in the dropdown without re-walking the session. */
  recordCount: number;
  nodeCount: number;
  /** Frozen SessionResponse at the moment of save. */
  session: SessionResponse;
}

const STORAGE_KEY = 'vs:debug-history:v1';
const MAX_ENTRIES = 20;

let cache: Ref<HistoryEntry[]> | null = null;

function readAll(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  let candidate = entries;
  // On quota errors, peel oldest entries off the tail until the write
  // succeeds — beats losing the new capture entirely.
  for (;;) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      return;
    } catch {
      if (candidate.length === 0) return;
      candidate = candidate.slice(0, -1);
    }
  }
}

function getCache(): Ref<HistoryEntry[]> {
  if (cache === null) cache = ref(readAll());
  return cache;
}

export interface DebugHistoryHandle {
  /** Entries for the bound widget, newest first. */
  entries: ComputedRef<HistoryEntry[]>;
  /** All entries across widgets — for a future global-history view. */
  all: ComputedRef<HistoryEntry[]>;
  save(input: Omit<HistoryEntry, 'id' | 'savedAt'>): HistoryEntry;
  remove(id: string): void;
  /** Wipe just this widget's entries; other widgets' remain. */
  clear(): void;
}

export function useDebugHistory(widget: DebugWidget): DebugHistoryHandle {
  const store = getCache();
  const entries = computed(() =>
    store.value
      .filter((e) => e.widget === widget)
      .slice()
      .sort((a, b) => b.savedAt - a.savedAt),
  );
  const all = computed(() => store.value.slice().sort((a, b) => b.savedAt - a.savedAt));

  /** Upsert by (widget, session.sessionId). When an entry for the
   *  same live session already exists, refresh its session snapshot
   *  + counts in place; the original `id` and `savedAt` (capture-start
   *  time) are preserved so deep-links stay stable across polls. When
   *  nothing meaningful changed (same recordCount/nodeCount), the
   *  write is skipped — capture polls 1×/s and we don't want to
   *  serialize 100s of KB to localStorage every tick. */
  function save(input: Omit<HistoryEntry, 'id' | 'savedAt'>): HistoryEntry {
    const idx = store.value.findIndex(
      (e) => e.widget === input.widget && e.session.sessionId === input.session.sessionId,
    );
    if (idx >= 0) {
      const existing = store.value[idx]!;
      if (existing.recordCount === input.recordCount && existing.nodeCount === input.nodeCount) {
        return existing;
      }
      const updated: HistoryEntry = {
        ...existing,
        ...input,
        id: existing.id,
        savedAt: existing.savedAt,
      };
      const next = store.value.slice();
      next[idx] = updated;
      store.value = next;
      writeAll(next);
      return updated;
    }
    const entry: HistoryEntry = {
      ...input,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      savedAt: Date.now(),
    };
    let next = [entry, ...store.value];
    // Cap PER widget so a busy MAL session never evicts saved LAL /
    // OAL captures. Walk the same-widget slice newest-first; drop any
    // that fall past MAX_ENTRIES.
    const sameWidget = next.filter((e) => e.widget === entry.widget);
    if (sameWidget.length > MAX_ENTRIES) {
      const dropIds = new Set(sameWidget.slice(MAX_ENTRIES).map((e) => e.id));
      next = next.filter((e) => !dropIds.has(e.id));
    }
    store.value = next;
    writeAll(next);
    return entry;
  }

  function remove(id: string): void {
    const next = store.value.filter((e) => e.id !== id);
    store.value = next;
    writeAll(next);
  }

  function clear(): void {
    const next = store.value.filter((e) => e.widget !== widget);
    store.value = next;
    writeAll(next);
  }

  return { entries, all, save, remove, clear };
}
