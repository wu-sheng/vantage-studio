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
 * Extract metric names from a MAL rule file body. The wire shape:
 *
 *   filter: ...
 *   expSuffix: ...
 *   metricPrefix: ...
 *   metricsRules:
 *     - name: <metric_name>
 *       exp: ...
 *
 *   # OR (legacy)
 *   rules:
 *     - metricsName: <metric_name>
 *       ...
 *
 * The two shapes coexist in OAP's MAL configs (`metricsRules` is the
 * 10.x rewrite; `rules` is the original). Both yield the same metric
 * name per rule, optionally prefixed by `metricPrefix`. We walk
 * either array and emit `prefix + name` when both are present.
 *
 * On parse failure (malformed YAML) we return an empty list rather
 * than throwing — the attribution layer should keep going for the
 * other files instead of failing the whole catalog merge.
 */

import { parse as parseYaml } from 'yaml';

interface MalRuleNode {
  name?: unknown;
  metricsName?: unknown;
}

interface MalRoot {
  metricPrefix?: unknown;
  metricsRules?: unknown;
  rules?: unknown;
}

export function parseMalMetricNames(content: string): string[] {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return [];
  }
  if (typeof doc !== 'object' || doc === null) return [];
  const root = doc as MalRoot;
  const prefix =
    typeof root.metricPrefix === 'string' && root.metricPrefix.length > 0
      ? `${root.metricPrefix}_`
      : '';
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (rules: unknown) => {
    if (!Array.isArray(rules)) return;
    for (const r of rules) {
      if (typeof r !== 'object' || r === null) continue;
      const node = r as MalRuleNode;
      const raw =
        typeof node.name === 'string'
          ? node.name
          : typeof node.metricsName === 'string'
            ? node.metricsName
            : null;
      if (!raw) continue;
      const full = prefix + raw;
      if (seen.has(full)) continue;
      seen.add(full);
      out.push(full);
    }
  };
  collect(root.metricsRules);
  collect(root.rules);
  return out;
}
