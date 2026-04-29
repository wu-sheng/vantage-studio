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

import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.github',
  'target',
  '.pnpm-store',
]);
const EXPECTED_PHRASE = 'Licensed under the Apache License, Version 2.0';
const HEAD_BYTES = 1024;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name))) {
      yield full;
    }
  }
}

const root = process.cwd();
const missing = [];

for await (const file of walk(root)) {
  const buf = await readFile(file, 'utf8');
  const head = buf.slice(0, HEAD_BYTES);
  if (!head.includes(EXPECTED_PHRASE)) {
    missing.push(relative(root, file));
  }
}

if (missing.length > 0) {
  console.error(`Missing Apache 2.0 license header in ${missing.length} file(s):`);
  for (const f of missing) console.error('  ' + f);
  process.exit(1);
}

console.log('License headers OK.');
