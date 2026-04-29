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

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rrDark, rrLight, TOKEN_KEYS } from '../src/tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS = join(__dirname, '..', 'src', 'tokens.css');

describe('design-tokens', () => {
  it('rrDark and rrLight have the same keys', () => {
    expect(Object.keys(rrLight).sort()).toEqual(Object.keys(rrDark).sort());
  });

  it('TOKEN_KEYS lists every key in rrDark', () => {
    expect([...TOKEN_KEYS].sort()).toEqual(Object.keys(rrDark).sort());
  });

  it('tokens.css exposes every rrDark token as --rr-<key>', async () => {
    const css = await readFile(TOKENS_CSS, 'utf8');
    for (const key of TOKEN_KEYS) {
      const expected = `--rr-${key}:`;
      expect(css.includes(expected), `tokens.css missing ${expected}`).toBe(true);
    }
  });

  it('tokens.css exposes the dark and light themes', async () => {
    const css = await readFile(TOKENS_CSS, 'utf8');
    expect(css).toMatch(/\[data-theme=['"]dark['"]\]/);
    expect(css).toMatch(/\[data-theme=['"]light['"]\]/);
  });

  it('font and spacing custom properties are present', async () => {
    const css = await readFile(TOKENS_CSS, 'utf8');
    expect(css).toContain('--rr-font-mono:');
    expect(css).toContain('--rr-font-ui:');
    expect(css).toContain('--rr-space-4:');
    expect(css).toContain('--rr-radius-md:');
  });
});
