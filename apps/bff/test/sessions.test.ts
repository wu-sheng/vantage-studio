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
import { InMemorySessionStore } from '../src/auth/sessions.js';

describe('InMemorySessionStore', () => {
  it('creates, retrieves, and deletes a session', () => {
    const store = new InMemorySessionStore();
    const s = store.create('alice', ['admin'], 60_000);
    expect(s.username).toBe('alice');
    expect(s.sid).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.sid.length).toBeGreaterThan(20);

    const got = store.get(s.sid);
    expect(got?.username).toBe('alice');

    expect(store.delete(s.sid)).toBe(true);
    expect(store.get(s.sid)).toBeUndefined();
  });

  it('uses a fresh sid per call', () => {
    const store = new InMemorySessionStore();
    const a = store.create('u', [], 1000);
    const b = store.create('u', [], 1000);
    expect(a.sid).not.toBe(b.sid);
  });

  it('lazily evicts expired sessions on get()', () => {
    let now = 1_000_000;
    const store = new InMemorySessionStore({ now: () => now });

    const s = store.create('alice', [], 5_000);
    expect(store.get(s.sid)).toBeDefined();

    now += 5_001;
    expect(store.get(s.sid)).toBeUndefined();
    // After lazy eviction, it should be gone from the underlying map too.
    expect(store.size()).toBe(0);
  });

  it('reaper drops every expired entry in one pass', () => {
    let now = 0;
    const store = new InMemorySessionStore({ now: () => now });

    store.create('a', [], 100);
    store.create('b', [], 200);
    store.create('c', [], 300);
    expect(store.size()).toBe(3);

    now = 250;
    expect(store.reapExpired()).toBe(2);
    expect(store.size()).toBe(1);
  });
});
