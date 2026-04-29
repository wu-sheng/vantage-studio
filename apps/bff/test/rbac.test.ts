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
import { hasVerb, isRbacEnabled, resolveVerbs, sessionHasVerb } from '../src/rbac/policy.js';
import { makeConfig } from './helpers.js';

describe('RBAC policy', () => {
  it('grants `*` when rbac is absent', () => {
    const cfg = makeConfig();
    expect(isRbacEnabled(cfg)).toBe(false);
    expect(resolveVerbs(cfg, ['anything'])).toEqual(['*']);
    expect(sessionHasVerb(cfg, [], 'rule:write')).toBe(true);
  });

  it('grants `*` when rbac.enabled is false', () => {
    const cfg = makeConfig({
      rbac: { enabled: false, roles: { admin: { verbs: ['*'] } } },
    });
    expect(isRbacEnabled(cfg)).toBe(false);
    expect(sessionHasVerb(cfg, [], 'rule:write')).toBe(true);
  });

  it('resolves the union of verbs across roles', () => {
    const cfg = makeConfig({
      rbac: {
        enabled: true,
        roles: {
          reader: { verbs: ['rule:read', 'cluster:read'] },
          writer: { verbs: ['rule:write'] },
        },
      },
    });
    expect(new Set(resolveVerbs(cfg, ['reader', 'writer']))).toEqual(
      new Set(['rule:read', 'cluster:read', 'rule:write']),
    );
  });

  it('honours the `*` wildcard', () => {
    const cfg = makeConfig({
      rbac: {
        enabled: true,
        roles: { admin: { verbs: ['*'] } },
      },
    });
    expect(sessionHasVerb(cfg, ['admin'], 'rule:write:structural')).toBe(true);
  });

  it('denies a verb the user does not have', () => {
    const cfg = makeConfig({
      rbac: {
        enabled: true,
        roles: { reader: { verbs: ['rule:read'] } },
      },
    });
    expect(sessionHasVerb(cfg, ['reader'], 'rule:write')).toBe(false);
  });

  it('skips unknown role names', () => {
    const cfg = makeConfig({
      rbac: { enabled: true, roles: { reader: { verbs: ['rule:read'] } } },
    });
    expect(resolveVerbs(cfg, ['nope'])).toEqual([]);
    expect(hasVerb([], 'rule:read')).toBe(false);
  });
});
