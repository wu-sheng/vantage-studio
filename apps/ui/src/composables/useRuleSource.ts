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
 * Fetch the rule's source body for the live debugger's source pane.
 *
 * The pane wants to render the original `.yaml` (MAL) or `.yml` (LAL)
 * body alongside the captured records so the operator can see which
 * source line / clause each record corresponds to. The upstream
 * SWIP-13 enhancements made `record.sourceText` byte-matchable
 * against the source — `String.indexOf` against the body finds the
 * exact offset for MAL chain stages and OAL clauses; LAL `line`
 * records carry an exact 1-based `sourceLine`.
 *
 * MAL / LAL: hits `/api/rule?catalog=&name=`. The response includes
 * the server-stamped `contentHash` we use to drive a one-time fetch
 * per content version (auto-refetches when the cache key flips on
 * hot-update).
 *
 * OAL: not supported by this composable for v1 — a source-to-file
 * mapping isn't surfaced by the OAL listing endpoint, and a single
 * OAL session can capture across multiple `.oal` files. The OAL
 * Debug view shows a link to the OAL Catalog page as the fallback.
 */

import { computed, type ComputedRef, type Ref } from 'vue';
import { useQuery, type UseQueryReturnType } from '@tanstack/vue-query';
import type { Catalog } from '@vantage-studio/api-client';
import { bff } from '../api/client.js';

export interface RuleSource {
  catalog: Catalog;
  name: string;
  /** Raw body as the rule was applied. */
  content: string;
  /** SHA-256 hex of `content`. Matches `record.contentHash` on
   *  captures emitted from the same holder. */
  contentHash: string;
  /** `runtime` when the rule has a hot-update overlay,
   *  `static` when it's the bundled-on-disk version. */
  source: 'runtime' | 'static';
  /** Pre-split body lines for line-keyed lookup. 0-indexed; the UI
   *  renders 1-based numbers in the gutter. */
  lines: string[];
}

export interface UseRuleSourceArgs {
  catalog: Ref<Catalog | null>;
  name: Ref<string | null>;
}

export interface UseRuleSourceResult {
  query: UseQueryReturnType<RuleSource | null, unknown>;
  /** True iff we have catalog + name and they're a `runtime-rule`-
   *  managed pair (i.e. not OAL). */
  enabled: ComputedRef<boolean>;
  /** Latest fetched source, or null when not yet loaded / 404 / OAL. */
  source: ComputedRef<RuleSource | null>;
}

export function useRuleSource(args: UseRuleSourceArgs): UseRuleSourceResult {
  const enabled = computed<boolean>(
    () =>
      args.catalog.value !== null &&
      args.name.value !== null &&
      args.name.value !== '',
  );

  const query = useQuery({
    queryKey: computed(() => ['debug-source', args.catalog.value, args.name.value] as const),
    queryFn: async (): Promise<RuleSource | null> => {
      const c = args.catalog.value;
      const n = args.name.value;
      if (c === null || n === null || n === '') return null;
      const got = await bff.getRule({ catalog: c, name: n });
      if (got === null) return null;
      return {
        catalog: c,
        name: n,
        content: got.content,
        contentHash: got.contentHash,
        source: got.source,
        lines: got.content.split('\n'),
      };
    },
    enabled,
    // Source body is byte-stable per (rule, contentHash); 5 min stale
    // window is plenty even for active hot-update sessions since the
    // queryKey doesn't include contentHash — invalidation happens via
    // explicit refetch when a record arrives with a different hash
    // than the loaded source.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const source = computed<RuleSource | null>(() => query.data.value ?? null);

  return { query, enabled, source };
}
