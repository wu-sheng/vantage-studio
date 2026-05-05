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
import { findLineMatches } from '../src/views/debug/sourceMatch.js';

describe('findLineMatches', () => {
  it('returns empty for empty inputs', () => {
    expect(findLineMatches('', 'sum')).toEqual([]);
    expect(findLineMatches('a\nb\n', '')).toEqual([]);
    expect(findLineMatches('a\nb\n', '   ')).toEqual([]);
  });

  it('matches a MAL chain fragment on its line', () => {
    const body = [
      'expSuffix: instance(["host"], Layer.VM)',
      'metricsRules:',
      '  - name: vm_memory_available_percent',
      "    exp: node_memory_MemAvailable_bytes.tagEqual('kind', 'mem').sum(['service'])",
    ].join('\n');
    const got = findLineMatches(body, "tagEqual('kind', 'mem')");
    expect(got).toEqual([4]);
  });

  it('returns multiple lines when the fragment appears multiple times', () => {
    const body = [
      'a',
      'cpm()',
      'b',
      'cpm()',
      'c',
      '   cpm()  ', // padded — still matches the trimmed needle
    ].join('\n');
    const got = findLineMatches(body, 'cpm()');
    expect(got).toEqual([2, 4, 6]);
  });

  it('matches an OAL filter clause verbatim', () => {
    const body = [
      'service_relation_server_cpm = from(ServiceRelation.*)',
      '    .filter(detectPoint == DetectPoint.SERVER)',
      '    .cpm();',
    ].join('\n');
    const got = findLineMatches(body, 'filter(detectPoint == DetectPoint.SERVER)');
    expect(got).toEqual([2]);
  });

  it('trims the needle before matching', () => {
    const body = 'one\ntwo\nthree\n';
    expect(findLineMatches(body, '  two  ')).toEqual([2]);
  });

  it('handles trailing newline / final line correctly', () => {
    const body = 'line1\nlineFinal';
    expect(findLineMatches(body, 'lineFinal')).toEqual([2]);
  });

  it('returns deduped sorted line numbers', () => {
    // Two adjacent matches on the same line should appear once.
    const body = 'aa aa aa\n';
    expect(findLineMatches(body, 'aa')).toEqual([1]);
  });

  it('returns empty when needle is absent', () => {
    expect(findLineMatches('one\ntwo\n', 'three')).toEqual([]);
  });
});
