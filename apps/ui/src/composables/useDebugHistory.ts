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

  function save(input: Omit<HistoryEntry, 'id' | 'savedAt'>): HistoryEntry {
    const entry: HistoryEntry = {
      ...input,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      savedAt: Date.now(),
    };
    let next = [entry, ...store.value];
    if (next.length > MAX_ENTRIES) next = next.slice(0, MAX_ENTRIES);
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
