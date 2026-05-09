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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@vantage-studio/api-client';

/** Build a minimal SessionResponse stub — just enough for the
 *  composable's upsert key (sessionId) and counts. */
function fakeSession(
  sessionId: string,
  nodes: number = 1,
  recordsPerNode: number = 0,
): SessionResponse {
  return {
    sessionId,
    capturedAt: 1_000_000_000_000,
    nodes: Array.from({ length: nodes }, (_, i) => ({
      nodeId: `n${i}`,
      status: 'ok',
      records: Array.from({ length: recordsPerNode }, (_, r) => ({
        startedAtMs: 1_000_000_000_000 + r,
        dsl: 'stub',
        rule: { ruleName: 'r' },
        samples: [],
      })),
    })),
  };
}

interface SaveInput {
  widget: 'mal' | 'lal' | 'oal';
  catalog: string;
  name: string;
  ruleName: string;
  retentionDeadline?: number;
  recordCount: number;
  nodeCount: number;
  session: SessionResponse;
}

function baseSave(
  sessionId: string,
  recordCount: number,
  opts: Partial<SaveInput> = {},
): SaveInput {
  return {
    widget: 'mal',
    catalog: 'otel-rules',
    name: 'mal-with-filter',
    ruleName: 'm',
    recordCount,
    nodeCount: 1,
    session: fakeSession(sessionId, 1, recordCount),
    ...opts,
  };
}

describe('useDebugHistory', () => {
  beforeEach(async () => {
    localStorage.clear();
    // The composable caches a singleton ref module-scoped. Reset
    // modules between tests so each test sees a fresh cache hydrated
    // from the (cleared) localStorage.
    vi.resetModules();
  });

  it('upserts by (widget, sessionId): same id updates in place, distinct ids stack', async () => {
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const h = useDebugHistory('mal');

    const first = h.save(baseSave('s1', 0));
    expect(h.entries.value).toHaveLength(1);

    const second = h.save(baseSave('s1', 5));
    expect(h.entries.value).toHaveLength(1);
    expect(second.id).toBe(first.id); // id preserved across updates
    expect(second.savedAt).toBe(first.savedAt); // savedAt = session start
    expect(second.recordCount).toBe(5);

    h.save(baseSave('s2', 1));
    expect(h.entries.value).toHaveLength(2);
  });

  it('skip-if-unchanged: identical counts + deadline avoid the localStorage write', async () => {
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const h = useDebugHistory('mal');

    h.save(baseSave('s1', 3, { retentionDeadline: 9_999 }));
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem');

    h.save(baseSave('s1', 3, { retentionDeadline: 9_999 }));
    expect(writeSpy).not.toHaveBeenCalled();

    h.save(baseSave('s1', 4, { retentionDeadline: 9_999 }));
    expect(writeSpy).toHaveBeenCalledTimes(1);

    writeSpy.mockRestore();
  });

  it('persists retentionDeadline when arrives later (counts unchanged)', async () => {
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const h = useDebugHistory('mal');

    h.save(baseSave('s1', 0)); // no deadline yet
    const second = h.save(baseSave('s1', 0, { retentionDeadline: 12_345 }));
    expect(second.retentionDeadline).toBe(12_345);
  });

  it('per-widget cap: a busy widget never evicts saved entries from another widget', async () => {
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const mal = useDebugHistory('mal');
    const lal = useDebugHistory('lal');

    // Save 25 MAL entries (cap is 20).
    for (let i = 0; i < 25; i++) {
      mal.save(baseSave(`mal-${i}`, 1));
    }
    // And one LAL entry that mustn't get crowded out.
    lal.save(
      baseSave('lal-keep', 1, { widget: 'lal', catalog: 'lal', name: 'demo', ruleName: 'r' }),
    );

    expect(mal.entries.value.length).toBe(20);
    expect(lal.entries.value.length).toBe(1);
    expect(lal.entries.value[0]?.session.sessionId).toBe('lal-keep');
  });

  it('isActive flips when retentionDeadline passes', async () => {
    const { isActive } = await import('../src/composables/useDebugHistory.js');
    const future = { retentionDeadline: 2_000 } as { retentionDeadline?: number };
    const past = { retentionDeadline: 500 } as { retentionDeadline?: number };
    const noDeadline = {} as { retentionDeadline?: number };

    expect(isActive(future as never, 1_000)).toBe(true);
    expect(isActive(past as never, 1_000)).toBe(false);
    expect(isActive(noDeadline as never, 1_000)).toBe(false);
  });

  it('survives reload: writes hit localStorage and a fresh module re-reads them', async () => {
    {
      const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
      const h = useDebugHistory('mal');
      h.save(baseSave('s1', 7));
    }
    vi.resetModules();
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const h = useDebugHistory('mal');
    expect(h.entries.value).toHaveLength(1);
    expect(h.entries.value[0]?.session.sessionId).toBe('s1');
    expect(h.entries.value[0]?.recordCount).toBe(7);
  });

  it('remove + clear: targeted delete keeps other widgets intact', async () => {
    const { useDebugHistory } = await import('../src/composables/useDebugHistory.js');
    const mal = useDebugHistory('mal');
    const lal = useDebugHistory('lal');
    mal.save(baseSave('m1', 1));
    mal.save(baseSave('m2', 1));
    lal.save(baseSave('l1', 1, { widget: 'lal', catalog: 'lal', name: 'demo', ruleName: 'r' }));

    const m1Id = mal.entries.value.find((e) => e.session.sessionId === 'm1')?.id;
    expect(m1Id).toBeDefined();
    mal.remove(m1Id!);
    expect(mal.entries.value).toHaveLength(1);
    expect(lal.entries.value).toHaveLength(1);

    mal.clear();
    expect(mal.entries.value).toHaveLength(0);
    expect(lal.entries.value).toHaveLength(1);
  });
});
