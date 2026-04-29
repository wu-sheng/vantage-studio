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
 * Bundled MAL grammar snapshot for Monaco autocomplete. v1 ships a
 * static snapshot keyed on the OAP version we tested against — the
 * upstream `/runtime/rule/dsl/schema` endpoint doesn't exist yet
 * (deferred; see feedback_skip_gap_apis memory).
 *
 * Source: SkyWalking docs (concepts-and-designs/mal.md) and
 * `oap-server/server-core/src/main/java/.../mal/...`. Conservative
 * subset — covers the operators / scopes / functions the bundled
 * `otel-rules/*.yaml` files use.
 */

export interface DslEntry {
  label: string;
  /** Documentation rendered in the autocomplete tooltip. */
  detail: string;
  /** Snippet body inserted on accept. `${1:name}` etc. — Monaco
   *  snippet syntax. */
  insertText: string;
}

/** Top-level YAML keys allowed in a MAL rule file. */
export const MAL_TOP_KEYS: DslEntry[] = [
  {
    label: 'expSuffix',
    detail: 'Expression suffix appended to every rule',
    insertText: 'expSuffix: ',
  },
  {
    label: 'metricPrefix',
    detail: 'Prefix added to every emitted metric name',
    insertText: 'metricPrefix: ',
  },
  { label: 'metricsRules', detail: 'List of metric rules', insertText: 'metricsRules:\n  - ' },
];

export const MAL_SCOPES: DslEntry[] = [
  { label: 'service', detail: 'Service-scoped metric', insertText: 'service' },
  { label: 'instance', detail: 'Service-instance-scoped metric', insertText: 'instance' },
  { label: 'endpoint', detail: 'Endpoint-scoped metric', insertText: 'endpoint' },
  {
    label: 'serviceRelation',
    detail: 'Service-to-service relation',
    insertText: 'serviceRelation',
  },
  {
    label: 'instanceRelation',
    detail: 'Instance-to-instance relation',
    insertText: 'instanceRelation',
  },
  { label: 'process', detail: 'eBPF process scope', insertText: 'process' },
];

export const MAL_DOWNSAMPLINGS: DslEntry[] = [
  { label: 'AVG', detail: 'Average over the persistence window', insertText: 'AVG' },
  { label: 'SUM', detail: 'Sum over the persistence window', insertText: 'SUM' },
  { label: 'LATEST', detail: 'Latest value seen', insertText: 'LATEST' },
  { label: 'MIN', detail: 'Minimum over the window', insertText: 'MIN' },
  { label: 'MAX', detail: 'Maximum over the window', insertText: 'MAX' },
];

/** SampleFamily methods most commonly used in MAL rules. Not
 *  exhaustive — captures the high-frequency surface. */
export const MAL_FUNCTIONS: DslEntry[] = [
  { label: '.tag', detail: 'Add or transform a label', insertText: '.tag(${1:name}, ${2:value})' },
  {
    label: '.filter',
    detail: "Drop samples that don't match the predicate",
    insertText: '.filter(${1:expr})',
  },
  {
    label: '.tagEqual',
    detail: 'Filter where label == value',
    insertText: '.tagEqual(${1:name}, ${2:value})',
  },
  {
    label: '.tagNotEqual',
    detail: 'Filter where label != value',
    insertText: '.tagNotEqual(${1:name}, ${2:value})',
  },
  {
    label: '.tagMatch',
    detail: 'Filter where label matches regex',
    insertText: '.tagMatch(${1:name}, ${2:regex})',
  },
  { label: '.sum', detail: 'Sum across labels', insertText: '.sum([${1:by}])' },
  { label: '.histogram', detail: 'Bucket samples into a histogram', insertText: '.histogram()' },
  {
    label: '.histogram_percentile',
    detail: 'Percentile from a histogram',
    insertText: '.histogram_percentile([${1:50,75,90,95,99}])',
  },
  { label: '.rate', detail: 'Per-second rate', insertText: '.rate()' },
  { label: '.irate', detail: 'Instant rate', insertText: '.irate()' },
  { label: '.increase', detail: 'Increase over a window', insertText: '.increase(${1:PT1M})' },
  {
    label: '.downsampling',
    detail: 'Downsampling function',
    insertText: '.downsampling(${1:AVG})',
  },
  {
    label: '.service',
    detail: 'Bind to service scope',
    insertText: '.service([${1:label}], Layer.${2:GENERAL})',
  },
  {
    label: '.instance',
    detail: 'Bind to instance scope',
    insertText: '.instance([${1:hostlabel}], [${2:instlabel}], Layer.${3:GENERAL})',
  },
  {
    label: '.endpoint',
    detail: 'Bind to endpoint scope',
    insertText: '.endpoint([${1:svc}], [${2:ep}], Layer.${3:GENERAL})',
  },
];
