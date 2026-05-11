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
import { hhmmIntegerToMinutes, parseTimezone } from '../src/oap/server-time.js';

describe('hhmmIntegerToMinutes', () => {
  it.each([
    [0, 0],
    [800, 480],
    [-500, -300],
    [530, 330], // India / Sri Lanka
    [-330, -210], // Suriname
    [1300, 780], // some Pacific
    [-1200, -720], // Baker Island
  ])('%i → %i', (tz, expected) => {
    expect(hhmmIntegerToMinutes(tz)).toBe(expected);
  });
});

describe('parseTimezone', () => {
  it.each<[string | number, number | null]>([
    ['+0000', 0],
    ['+0800', 480],
    ['-0500', -300],
    ['+0530', 330],
    ['-0330', -210],
    ['0800', 480], // no-sign treated as positive
    ['+08:00', 480], // colon form
    ['-05:00', -300],
    ['UTC', null], // unparseable
    ['', null],
    [800, 480], // legacy integer
    [-500, -300],
    [NaN, null],
  ])('%j → %j', (tz, expected) => {
    expect(parseTimezone(tz)).toBe(expected);
  });
});
