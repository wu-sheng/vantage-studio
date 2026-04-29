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
import type { ListEnvelope } from '@vantage-studio/api-client';
import { pivotClusterState, type NodeListResult } from '../src/oap/cluster.js';

function envelope(rules: ListEnvelope['rules']): ListEnvelope {
  return {
    generatedAt: 1730000000000,
    loaderStats: { active: 0, pending: 0 },
    rules,
  };
}

const baseRule = {
  catalog: 'otel-rules' as const,
  name: 'vm',
  status: 'ACTIVE' as const,
  localState: 'RUNNING' as const,
  suspendOrigin: 'NONE' as const,
  loaderGc: 'LIVE' as const,
  loaderKind: 'RUNTIME' as const,
  loaderName: 'runtime:otel-rules/vm@0429-101900',
  bundled: false,
  updateTime: 1729999999000,
  lastApplyError: '',
  pendingUnregister: false as const,
};

describe('pivotClusterState', () => {
  it('marks a rule converged when every responding node has the same hash', () => {
    const perNode: NodeListResult[] = [
      {
        url: 'http://oap-1:17128',
        envelope: envelope([{ ...baseRule, contentHash: '7c3a' }]),
      },
      {
        url: 'http://oap-2:17128',
        envelope: envelope([{ ...baseRule, contentHash: '7c3a' }]),
      },
    ];
    const got = pivotClusterState(perNode, 1730000000000);
    expect(got.rules).toHaveLength(1);
    expect(got.rules[0]!.converged).toBe(true);
    expect(got.nodes.every((n) => n.ok)).toBe(true);
  });

  it('marks a rule diverged when two nodes disagree on hash', () => {
    const perNode: NodeListResult[] = [
      {
        url: 'http://oap-1:17128',
        envelope: envelope([{ ...baseRule, contentHash: '7c3a' }]),
      },
      {
        url: 'http://oap-2:17128',
        envelope: envelope([{ ...baseRule, contentHash: 'DIFF' }]),
      },
    ];
    const got = pivotClusterState(perNode);
    expect(got.rules[0]!.converged).toBe(false);
  });

  it('marks a rule diverged when a node is missing the rule entirely', () => {
    const perNode: NodeListResult[] = [
      {
        url: 'http://oap-1:17128',
        envelope: envelope([{ ...baseRule, contentHash: '7c3a' }]),
      },
      {
        url: 'http://oap-2:17128',
        envelope: envelope([]), // node responded but doesn't have this rule
      },
    ];
    const got = pivotClusterState(perNode);
    expect(got.rules[0]!.converged).toBe(false);
  });

  it('captures per-node failure without dropping the rest', () => {
    const perNode: NodeListResult[] = [
      {
        url: 'http://oap-1:17128',
        envelope: envelope([{ ...baseRule, contentHash: '7c3a' }]),
      },
      {
        url: 'http://oap-2:17128',
        envelope: null,
        error: 'ECONNREFUSED',
      },
    ];
    const got = pivotClusterState(perNode);
    expect(got.nodes).toHaveLength(2);
    expect(got.nodes[0]!.ok).toBe(true);
    expect(got.nodes[1]!.ok).toBe(false);
    expect(got.nodes[1]!.error).toBe('ECONNREFUSED');
    // With only one responding node, the single rule is still
    // "converged" (all responding nodes agree).
    expect(got.rules[0]!.converged).toBe(true);
  });

  it('preserves lastApplyError on operator rows; defaults to empty for bundled', () => {
    const perNode: NodeListResult[] = [
      {
        url: 'http://oap-1:17128',
        envelope: envelope([
          { ...baseRule, contentHash: 'aaa', lastApplyError: 'ddl_verify_failed: …' },
        ]),
      },
      {
        url: 'http://oap-2:17128',
        envelope: envelope([
          {
            catalog: 'lal',
            name: 'envoy-als',
            status: 'BUNDLED',
            localState: 'RUNNING',
            loaderGc: 'LIVE',
            loaderKind: 'STATIC',
            loaderName: 'static:lal/envoy-als@0429-101900',
            contentHash: 'b1d402',
            bundled: true,
            bundledContentHash: 'b1d402',
            pendingUnregister: false,
          },
        ]),
      },
    ];
    const got = pivotClusterState(perNode);
    const vm = got.rules.find((r) => r.name === 'vm')!;
    expect(vm.perNode['http://oap-1:17128']!.lastApplyError).toBe('ddl_verify_failed: …');

    const envoy = got.rules.find((r) => r.name === 'envoy-als')!;
    expect(envoy.perNode['http://oap-2:17128']!.lastApplyError).toBe('');
  });

  it('lists every configured node in nodes[] even if they did not respond', () => {
    const perNode: NodeListResult[] = [
      { url: 'http://oap-1:17128', envelope: null, error: 'timeout' },
      { url: 'http://oap-2:17128', envelope: null, error: 'timeout' },
    ];
    const got = pivotClusterState(perNode);
    expect(got.nodes).toHaveLength(2);
    expect(got.rules).toHaveLength(0);
  });
});
