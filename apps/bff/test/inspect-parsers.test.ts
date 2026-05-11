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
import { parseOalMetricNames } from '../src/inspect/parser-oal.js';
import { parseMalMetricNames } from '../src/inspect/parser-mal.js';

describe('parseOalMetricNames', () => {
  it('extracts LHS metric names from realistic OAL', () => {
    const src = `
// core.oal — realistic snippet
service_cpm = from(Service.*).cpm();
service_resp_time = from(Service.latency).longAvg();
/* block comment
   noise = from(Anything).whatever(); */
service_apdex = from(Service.latency).apdex(name, status);
`;
    expect(parseOalMetricNames(src)).toEqual(['service_cpm', 'service_resp_time', 'service_apdex']);
  });

  it('deduplicates same metric appearing twice', () => {
    const src = 'a = from(X.y).foo();\na = from(X.z).bar();';
    expect(parseOalMetricNames(src)).toEqual(['a']);
  });

  it('ignores `==` and trailing whitespace edge cases', () => {
    // Lines that aren't an assignment must not be picked up.
    const src = `
if (x == 1) {}
// some_metric = from(... in comment
real_metric = from(Service.foo).cpm();
`;
    expect(parseOalMetricNames(src)).toEqual(['real_metric']);
  });

  it('returns empty for empty input', () => {
    expect(parseOalMetricNames('')).toEqual([]);
  });
});

describe('parseMalMetricNames', () => {
  it('walks `metricsRules[*].name` with metricPrefix applied', () => {
    const yaml = `
metricPrefix: instance_jvm_memory
metricsRules:
  - name: heap_used
    exp: jvm_memory_used_bytes.tagEqual('area','heap').sum(['service','instance'])
  - name: heap_max
    exp: jvm_memory_max_bytes.tagEqual('area','heap').sum(['service','instance'])
`;
    expect(parseMalMetricNames(yaml)).toEqual([
      'instance_jvm_memory_heap_used',
      'instance_jvm_memory_heap_max',
    ]);
  });

  it('walks the legacy `rules[*].metricsName` shape', () => {
    const yaml = `
rules:
  - metricsName: meter_node_cpu_total_percentage
    exp: ...
  - metricsName: meter_node_cpu_system_percentage
    exp: ...
`;
    expect(parseMalMetricNames(yaml)).toEqual([
      'meter_node_cpu_total_percentage',
      'meter_node_cpu_system_percentage',
    ]);
  });

  it('returns [] on malformed YAML', () => {
    expect(parseMalMetricNames(': not\nvalid: -:')).toEqual([]);
  });

  it('returns [] when neither rules[] nor metricsRules[] is present', () => {
    expect(parseMalMetricNames('filter: foo\nbar: baz')).toEqual([]);
  });
});
