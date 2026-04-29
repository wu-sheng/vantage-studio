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
 * studio.yaml loader + chokidar-backed hot-reload.
 *
 * `loadConfig(path)` returns a `ConfigHandle` whose `current()` always
 * returns the latest valid config. On change, the watcher re-parses;
 * if invalid, it logs and keeps the previous config (Studio doesn't
 * crash because someone made a typo).
 */

import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'chokidar';
import { parse as parseYaml } from 'yaml';
import { parseStudioConfig, type StudioConfig } from './schema.js';

export interface ConfigHandle {
  /** Latest valid config. Always non-null after `loadConfig` resolves. */
  current(): StudioConfig;
  /** Subscribe to reload events. Returns an unsubscribe fn. */
  onChange(listener: (cfg: StudioConfig) => void): () => void;
  /** Stop watching the file. */
  stop(): Promise<void>;
}

export interface LoadConfigOptions {
  /** Override watcher polling for tests on filesystems that don't
   *  emit events reliably. */
  usePolling?: boolean;
  /** Surface to the caller's logger. */
  log?: {
    info(msg: string, ...rest: unknown[]): void;
    warn(msg: string, ...rest: unknown[]): void;
    error(msg: string, ...rest: unknown[]): void;
  };
}

class Handle extends EventEmitter implements ConfigHandle {
  private value: StudioConfig;
  private watcher: FSWatcher | null;
  private readonly log: NonNullable<LoadConfigOptions['log']>;

  constructor(
    initial: StudioConfig,
    watcher: FSWatcher | null,
    log: NonNullable<LoadConfigOptions['log']>,
  ) {
    super();
    this.value = initial;
    this.watcher = watcher;
    this.log = log;
  }

  current(): StudioConfig {
    return this.value;
  }

  onChange(listener: (cfg: StudioConfig) => void): () => void {
    this.on('change', listener);
    return () => this.off('change', listener);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.removeAllListeners();
  }

  /** @internal — used by the loader to swap config after a file change. */
  swap(next: StudioConfig): void {
    this.value = next;
    this.emit('change', next);
  }

  /** @internal */
  reportError(err: unknown): void {
    this.log.error('config reload failed; keeping previous config', err);
  }
}

async function readAndParse(path: string): Promise<StudioConfig> {
  const text = await readFile(path, 'utf8');
  const raw: unknown = parseYaml(text);
  return parseStudioConfig(raw);
}

const noopLog: NonNullable<LoadConfigOptions['log']> = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export async function loadConfig(
  path: string,
  opts: LoadConfigOptions = {},
): Promise<ConfigHandle> {
  const log = opts.log ?? noopLog;

  // First load — surface failures directly to the caller, since there's
  // no previous config to fall back to.
  const initial = await readAndParse(path);

  const watcher = watch(path, {
    usePolling: opts.usePolling ?? false,
    ignoreInitial: true,
  });

  const handle = new Handle(initial, watcher, log);

  watcher.on('change', () => {
    void readAndParse(path).then(
      (next) => {
        log.info('studio.yaml reloaded');
        handle.swap(next);
      },
      (err) => handle.reportError(err),
    );
  });

  watcher.on('error', (err) => handle.reportError(err));

  return handle;
}

/** Build a ConfigHandle around an in-memory config — for tests + for
 *  consumers that have already parsed the YAML themselves. No file
 *  watcher attached. */
export function staticConfig(value: StudioConfig): ConfigHandle {
  return new Handle(value, null, noopLog);
}
