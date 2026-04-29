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

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStudioConfig } from '../src/config/schema.js';
import { loadConfig } from '../src/config/loader.js';

const SAMPLE = `
oap:
  adminUrls: ["http://oap:17128"]
  statusUrl: http://oap:12800
auth:
  backend: local
  local:
    users:
      - username: admin
        passwordHash: "$argon2id$..."
        roles: [admin]
`;

describe('StudioConfigSchema', () => {
  it('accepts a minimal config and applies defaults', () => {
    const cfg = parseStudioConfig({
      oap: { adminUrls: ['http://oap:17128'], statusUrl: 'http://oap:12800' },
      auth: { local: { users: [{ username: 'admin', passwordHash: 'h' }] } },
    });
    expect(cfg.server.listen).toBe('0.0.0.0:8080');
    expect(cfg.session.ttlMinutes).toBe(60);
    expect(cfg.session.cookieName).toBe('sid');
    expect(cfg.session.cookieSecure).toBe(true);
    expect(cfg.rbac).toBeUndefined();
  });

  it('rejects a username with bad characters', () => {
    expect(() =>
      parseStudioConfig({
        oap: { adminUrls: ['http://oap:17128'], statusUrl: 'http://oap:12800' },
        auth: { local: { users: [{ username: 'has space', passwordHash: 'h' }] } },
      }),
    ).toThrow();
  });

  it('rejects a verb in the wrong shape', () => {
    expect(() =>
      parseStudioConfig({
        oap: { adminUrls: ['http://oap:17128'], statusUrl: 'http://oap:12800' },
        auth: { local: { users: [{ username: 'a', passwordHash: 'h' }] } },
        rbac: { enabled: true, roles: { r: { verbs: ['NOT-A-VERB'] } } },
      }),
    ).toThrow();
  });

  it('accepts the wildcard verb and the canonical verbs', () => {
    const cfg = parseStudioConfig({
      oap: { adminUrls: ['http://oap:17128'], statusUrl: 'http://oap:12800' },
      auth: { local: { users: [{ username: 'a', passwordHash: 'h' }] } },
      rbac: {
        enabled: true,
        roles: {
          admin: { verbs: ['*'] },
          operator: { verbs: ['rule:read', 'rule:write', 'rule:write:structural'] },
        },
      },
    });
    expect(cfg.rbac?.enabled).toBe(true);
    expect(cfg.rbac?.roles.admin?.verbs).toEqual(['*']);
  });

  it('requires at least one OAP admin URL', () => {
    expect(() =>
      parseStudioConfig({
        oap: { adminUrls: [], statusUrl: 'http://oap:12800' },
        auth: { local: { users: [{ username: 'a', passwordHash: 'h' }] } },
      }),
    ).toThrow();
  });
});

describe('loadConfig', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vs-cfg-'));
    path = join(dir, 'studio.yaml');
    await writeFile(path, SAMPLE, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid file', async () => {
    const handle = await loadConfig(path, { usePolling: true });
    try {
      expect(handle.current().auth.local.users[0]!.username).toBe('admin');
    } finally {
      await handle.stop();
    }
  });

  it('keeps the previous config when the file becomes invalid', async () => {
    const errors: unknown[] = [];
    const handle = await loadConfig(path, {
      usePolling: true,
      log: {
        info: () => {},
        warn: () => {},
        error: (_m, e) => errors.push(e),
      },
    });
    try {
      const original = handle.current();
      // Write a syntactically broken YAML and wait for the watcher.
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(path, '::: not valid yaml :::', 'utf8');
      await new Promise((r) => setTimeout(r, 600));
      expect(handle.current()).toBe(original);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await handle.stop();
    }
  });

  it('emits a change event with the new config on a valid edit', async () => {
    const handle = await loadConfig(path, { usePolling: true });
    try {
      const fired = new Promise<void>((resolve) => {
        const off = handle.onChange((_cfg) => {
          off();
          resolve();
        });
      });
      await new Promise((r) => setTimeout(r, 50));
      const updated = SAMPLE.replace('roles: [admin]', 'roles: [operator-role]');
      await writeFile(path, updated, 'utf8');
      await fired;
      expect(handle.current().auth.local.users[0]!.roles).toContain('operator-role');
    } finally {
      await handle.stop();
    }
  });
});
