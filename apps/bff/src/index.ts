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
 * Process entrypoint. Reads the studio.yaml path from
 * `STUDIO_CONFIG` (default `/etc/studio/studio.yaml`), wires the
 * server, and listens on the configured `host:port`.
 *
 * Tests build the server directly via `buildServer()`; this file is
 * only invoked by the production process.
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadConfig } from './config/loader.js';
import { createAuditLogger } from './audit/logger.js';
import { InMemorySessionStore } from './auth/sessions.js';
import { buildServer } from './server.js';

/** First-run seed: when STUDIO_CONFIG points at a path that doesn't
 *  yet exist and STUDIO_CONFIG_EXAMPLE points at a baked-in defaults
 *  file, copy the example into place. Lets the Docker image come up
 *  on a fresh volume without an operator's hand-written studio.yaml. */
async function ensureConfig(targetPath: string): Promise<void> {
  try {
    await stat(targetPath);
    return; // exists
  } catch {
    // not present — fall through to seed
  }
  const example = process.env.STUDIO_CONFIG_EXAMPLE;
  if (!example) {
    throw new Error(`studio config missing at ${targetPath} and STUDIO_CONFIG_EXAMPLE is not set`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(example, targetPath);
  console.warn(
    `[vantage-studio] no config at ${targetPath}; seeded from ${example}. Edit it before exposing this instance.`,
  );
}

async function main(): Promise<void> {
  const configPath = process.env.STUDIO_CONFIG ?? '/etc/studio/studio.yaml';
  await ensureConfig(configPath);

  const config = await loadConfig(configPath, {
    log: {
      info: (m) => console.info(m),
      warn: (m, ...r) => console.warn(m, ...r),
      error: (m, ...r) => console.error(m, ...r),
    },
  });

  const cfg = config.current();
  const audit = await createAuditLogger({ file: cfg.audit.file });
  const sessions = new InMemorySessionStore();

  const uiDir = process.env.STUDIO_UI_DIR;
  const { app } = await buildServer({
    config,
    sessions,
    audit,
    ...(uiDir !== undefined ? { uiDir } : {}),
  });

  const reaper = setInterval(() => sessions.reapExpired(), 60_000);

  const stop = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(reaper);
    await app.close();
    await audit.close();
    await config.stop();
  };
  process.on('SIGINT', () => void stop('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => void stop('SIGTERM').then(() => process.exit(0)));

  const [host, portStr] = cfg.server.listen.split(':');
  if (!host || !portStr) {
    throw new Error(`invalid server.listen: ${cfg.server.listen}`);
  }
  const port = Number(portStr);
  await app.listen({ host, port });
}

main().catch((err: unknown) => {
  console.error('vantage-studio bff failed to start', err);
  process.exit(1);
});
