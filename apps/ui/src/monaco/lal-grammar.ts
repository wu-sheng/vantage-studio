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
 * Bundled LAL grammar snapshot for Monaco autocomplete. Same
 * disclaimer as mal-grammar: static snapshot, refresh manually until
 * `/runtime/rule/dsl/schema` lands upstream.
 *
 * Source: SkyWalking docs (concepts-and-designs/lal.md) and the
 * shipped `oap-server/server-starter/src/main/resources/lal/*.yaml`
 * examples (envoy-als, mysql-slowsql, k8s-service, …).
 */

import type { DslEntry } from './mal-grammar.js';

export const LAL_TOP_KEYS: DslEntry[] = [
  {
    label: 'rules',
    detail: 'List of LAL rule blocks',
    insertText: 'rules:\n  - name: ${1:rule}\n    ',
  },
];

export const LAL_RULE_KEYS: DslEntry[] = [
  { label: 'name', detail: 'Rule identifier', insertText: 'name: ' },
  {
    label: 'layer',
    detail: 'Layer this rule binds to (e.g. MESH, GENERAL)',
    insertText: 'layer: ',
  },
  { label: 'dsl', detail: 'Inline LAL DSL (groovy-style)', insertText: 'dsl: |\n  ' },
];

/** LAL DSL block keywords — used inside the `dsl: |` block. */
export const LAL_BLOCK_KEYWORDS: DslEntry[] = [
  { label: 'filter', detail: 'Top-level rule block', insertText: 'filter {\n  ${1}\n}' },
  { label: 'parser', detail: 'Parse the log body', insertText: 'parser {\n  ${1}\n}' },
  {
    label: 'extractor',
    detail: 'Extract typed fields + tags',
    insertText: 'extractor {\n  ${1}\n}',
  },
  {
    label: 'sink',
    detail: 'Routing decision (enforcer / sampler)',
    insertText: 'sink {\n  ${1}\n}',
  },
  { label: 'json', detail: 'JSON parser', insertText: 'json {\n  abortOnFailure ${1:true}\n}' },
  { label: 'text', detail: 'Plain-text body, no parsing', insertText: 'text {}' },
  { label: 'enforcer', detail: 'Always persist', insertText: 'enforcer {}' },
  {
    label: 'sampler',
    detail: 'Probabilistic sampling',
    insertText: 'sampler {\n  rateLimit("${1:key}") {\n    qps ${2:100}\n  }\n}',
  },
];

/** LAL extractor functions — frequently-used builders for fields. */
export const LAL_EXTRACTOR_FUNCS: DslEntry[] = [
  { label: 'service', detail: 'Set the service identity', insertText: 'service(${1:expr})' },
  { label: 'instance', detail: 'Set the instance identity', insertText: 'instance(${1:expr})' },
  { label: 'endpoint', detail: 'Set the endpoint identity', insertText: 'endpoint(${1:expr})' },
  { label: 'tag', detail: 'Add a tag to the log record', insertText: 'tag(${1:name}: ${2:value})' },
  {
    label: 'sourceAttribute',
    detail: 'Set source attribute (Layer auto-detect input)',
    insertText: 'sourceAttribute(${1:expr})',
  },
  {
    label: 'metrics',
    detail: 'Emit a metric to MAL',
    insertText:
      'metrics {\n  timestamp parsed.${1:ts}\n  labels = [${2:label}: parsed.${3:value}]\n  value = parsed.${4:metric}\n  name = "${5:metric_name}"\n}',
  },
];
