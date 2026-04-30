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

import { build } from 'esbuild';

/**
 * BFF production build — single ESM bundle.
 *
 * `argon2` is externalised because it ships a native `.node` binary
 * that esbuild cannot inline. Pino's worker-thread transports are
 * also kept external so pino's runtime worker resolver can find
 * them on disk. Everything else is inlined.
 *
 * The runtime image copies `node_modules/argon2` (with its prebuild
 * binaries) and `node_modules/pino` alongside the bundle. The
 * Dockerfile owns that step.
 */
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist/server.js',
  external: ['argon2', 'pino', 'thread-stream'],
  banner: {
    // Some externalised deps reach for `require()` at runtime; provide
    // it in the ESM bundle so they don't crash.
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
});
