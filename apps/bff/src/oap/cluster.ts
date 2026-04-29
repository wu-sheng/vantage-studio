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
 * Cluster state — fan-out `/runtime/rule/list` to every configured OAP
 * admin URL and pivot the result into a per-rule × per-node matrix the
 * SPA renders directly.
 *
 * The fan-out runs in parallel; one slow node doesn't delay the
 * others. Per-node failures are captured (so the operator can see
 * which node is unreachable) without failing the whole call.
 */

import type {
  Catalog,
  ListEnvelope,
  ListRow,
  LocalState,
  RuleStatus,
} from '@vantage-studio/api-client';
import type { OapClients } from './clients.js';

export interface NodeListResult {
  url: string;
  envelope: ListEnvelope | null;
  /** Set when `envelope === null`. */
  error?: string;
}

export interface ClusterRulePerNode {
  status: RuleStatus | null;
  localState: LocalState | null;
  contentHash: string | null;
  lastApplyError: string;
}

export interface ClusterRule {
  catalog: Catalog;
  name: string;
  /** True iff every responding node has this rule with the same
   *  contentHash. False when any node is missing the rule, or any two
   *  nodes disagree on contentHash. */
  converged: boolean;
  /** Map of admin URL → per-node state. A node that responded but
   *  doesn't have the rule appears with `status: null`. A node that
   *  didn't respond at all is omitted (its top-level `nodes[i].ok`
   *  surfaces the failure). */
  perNode: Record<string, ClusterRulePerNode>;
}

export interface ClusterStateResponse {
  generatedAt: number;
  /** Per-node availability summary. Includes every configured admin
   *  URL, even when the node didn't respond. */
  nodes: { url: string; ok: boolean; error?: string }[];
  rules: ClusterRule[];
}

/** Fan-out helper. Returns a per-node array preserving the input
 *  order; failed nodes have `envelope: null` + `error`. */
export async function fetchPerNode(clients: OapClients): Promise<NodeListResult[]> {
  const urls = clients.adminUrls();
  return Promise.all(
    urls.map(async (url): Promise<NodeListResult> => {
      try {
        const envelope = await clients.forUrl(url).list();
        return { url, envelope };
      } catch (err) {
        return {
          url,
          envelope: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

/** Pivot per-node `/list` envelopes into a per-rule matrix. Pure —
 *  takes the fan-out result and returns the response shape. */
export function pivotClusterState(
  perNode: NodeListResult[],
  generatedAt: number = Date.now(),
): ClusterStateResponse {
  const respondingUrls = perNode.filter((n) => n.envelope !== null).map((n) => n.url);

  const seen = new Map<string, ClusterRule>();
  for (const node of perNode) {
    if (!node.envelope) continue;
    for (const rule of node.envelope.rules) {
      const key = `${rule.catalog}/${rule.name}`;
      let entry = seen.get(key);
      if (!entry) {
        entry = {
          catalog: rule.catalog,
          name: rule.name,
          converged: false, // computed below
          perNode: {},
        };
        seen.set(key, entry);
      }
      entry.perNode[node.url] = {
        status: rule.status,
        localState: rule.localState,
        contentHash: rule.contentHash,
        lastApplyError: extractLastApplyError(rule),
      };
    }
  }

  // Convergence pass — all responding nodes must have the rule with the
  // same contentHash.
  for (const entry of seen.values()) {
    const presentOn = Object.keys(entry.perNode);
    if (presentOn.length !== respondingUrls.length) {
      entry.converged = false;
      continue;
    }
    const hashes = new Set(Object.values(entry.perNode).map((p) => p.contentHash));
    entry.converged = hashes.size === 1;
  }

  return {
    generatedAt,
    nodes: perNode.map((n) => ({
      url: n.url,
      ok: n.envelope !== null,
      ...(n.error !== undefined ? { error: n.error } : {}),
    })),
    rules: [...seen.values()],
  };
}

function extractLastApplyError(row: ListRow): string {
  // Operator-pushed rows carry the field; bundled / orphan rows don't.
  return 'lastApplyError' in row ? row.lastApplyError : '';
}
