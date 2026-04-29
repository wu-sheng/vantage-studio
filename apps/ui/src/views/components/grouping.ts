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

import type { ListRow } from '@vantage-studio/api-client';

export interface RuleGroup {
  group: string;
  rules: ListRow[];
}

export const TOP_LEVEL = '(top level)';

/** Group rules by the first path segment of `name`. Names without `/`
 *  go into a `(top level)` group placed last. Within each group rules
 *  are sorted by name. */
export function groupRules(rules: readonly ListRow[]): RuleGroup[] {
  const map = new Map<string, ListRow[]>();
  for (const r of rules) {
    const idx = r.name.indexOf('/');
    const group = idx >= 0 ? r.name.slice(0, idx) : TOP_LEVEL;
    let bucket = map.get(group);
    if (!bucket) {
      bucket = [];
      map.set(group, bucket);
    }
    bucket.push(r);
  }
  const entries = [...map.entries()];
  entries.sort(([a], [b]) => {
    if (a === TOP_LEVEL) return 1;
    if (b === TOP_LEVEL) return -1;
    return a.localeCompare(b);
  });
  return entries.map(([group, list]) => ({
    group,
    rules: list.slice().sort((x, y) => x.name.localeCompare(y.name)),
  }));
}

/** "Modified from bundled" / "Override" / "Bundled-only" / null. */
export type OverrideKind = 'modified' | 'override' | 'bundled-only' | null;

export function overrideKind(rule: ListRow): OverrideKind {
  if (rule.status === 'BUNDLED') return 'bundled-only';
  if (!rule.bundled) return null;
  if (rule.bundledContentHash && rule.contentHash !== rule.bundledContentHash) {
    return 'modified';
  }
  return 'override';
}

/** "2m ago", "yesterday", etc. — used by RuleCard for ACTIVE/INACTIVE
 *  rows. Coarse on purpose: minute-precision is more honest given
 *  cluster-tick latency. */
export function formatRelativeTime(updateTime: number, now: number = Date.now()): string {
  const diffMs = now - updateTime;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(updateTime).toISOString().slice(0, 10);
}
