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

import { describe, expect, it } from 'vitest';
import type { ListRow } from '@vantage-studio/api-client';
import {
  groupRules,
  overrideKind,
  formatRelativeTime,
  TOP_LEVEL,
} from '../src/views/components/grouping.js';

const operatorBase = {
  catalog: 'otel-rules' as const,
  status: 'ACTIVE' as const,
  localState: 'RUNNING' as const,
  suspendOrigin: 'NONE' as const,
  loaderGc: 'LIVE' as const,
  loaderKind: 'RUNTIME' as const,
  loaderName: 'runtime:otel-rules/x@0429',
  bundled: false,
  updateTime: 1730000000000,
  lastApplyError: '',
  pendingUnregister: false as const,
};

function row(overrides: Partial<ListRow>): ListRow {
  return { ...operatorBase, name: 'x', contentHash: 'aaa', ...(overrides as object) } as ListRow;
}

describe('groupRules', () => {
  it('buckets by first path segment, top-level last, sorted by name', () => {
    const groups = groupRules([
      row({ name: 'vm' }),
      row({ name: 'k8s/pod' }),
      row({ name: 'k8s/node' }),
      row({ name: 'aws-gateway/gateway-service' }),
      row({ name: 'nginx' }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['aws-gateway', 'k8s', TOP_LEVEL]);
    expect(groups[1]!.rules.map((r) => r.name)).toEqual(['k8s/node', 'k8s/pod']);
    expect(groups[2]!.rules.map((r) => r.name)).toEqual(['nginx', 'vm']);
  });

  it('returns an empty list for an empty input', () => {
    expect(groupRules([])).toEqual([]);
  });
});

describe('overrideKind', () => {
  it('marks BUNDLED rows as bundled-only', () => {
    expect(
      overrideKind(
        row({
          status: 'BUNDLED',
          bundled: true,
          contentHash: 'aaa',
          bundledContentHash: 'aaa',
          // BUNDLED rows omit suspendOrigin / updateTime / etc; the
          // helper just narrows by status, so the test row works.
        } as Partial<ListRow>),
      ),
    ).toBe('bundled-only');
  });

  it('marks an operator row with no static twin as null', () => {
    expect(overrideKind(row({ bundled: false }))).toBe(null);
  });

  it('marks override when hashes match the bundled twin', () => {
    expect(
      overrideKind(row({ bundled: true, contentHash: 'aaa', bundledContentHash: 'aaa' })),
    ).toBe('override');
  });

  it('marks modified when hashes diverge from the bundled twin', () => {
    expect(
      overrideKind(row({ bundled: true, contentHash: 'aaa', bundledContentHash: 'bbb' })),
    ).toBe('modified');
  });
});

describe('formatRelativeTime', () => {
  const now = 1_730_000_000_000;
  it('returns seconds, minutes, hours, days, then ISO date', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe('yesterday');
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe('3d ago');
    expect(formatRelativeTime(now - 30 * 24 * 3_600_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
