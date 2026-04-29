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

import { describe, expect, it, vi } from 'vitest';
import { verifyLocalLogin } from '../src/auth/local.js';
import { makeConfig } from './helpers.js';

describe('verifyLocalLogin', () => {
  it('succeeds when the username matches and verify returns true', async () => {
    const cfg = makeConfig({
      users: [{ username: 'alice', passwordHash: '$argon2id$real-hash', roles: ['admin'] }],
    });
    const verify = vi.fn().mockResolvedValue(true);
    const result = await verifyLocalLogin(cfg, 'alice', 'pw', { verify });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.username).toBe('alice');
  });

  it('fails with bad_password when the user matches but verify says false', async () => {
    const cfg = makeConfig({
      users: [{ username: 'alice', passwordHash: '$argon2id$real-hash', roles: [] }],
    });
    const verify = vi.fn().mockResolvedValue(false);
    const result = await verifyLocalLogin(cfg, 'alice', 'pw', { verify });
    expect(result).toEqual({ ok: false, reason: 'bad_password' });
    expect(verify).toHaveBeenCalledWith('$argon2id$real-hash', 'pw');
  });

  it('fails with unknown_user but still calls verify (timing)', async () => {
    const cfg = makeConfig({
      users: [{ username: 'alice', passwordHash: '$argon2id$real-hash', roles: [] }],
    });
    const verify = vi.fn().mockResolvedValue(true);
    const result = await verifyLocalLogin(cfg, 'mallory', 'pw', { verify });
    // Even if dummy verify returns true, the result is unknown_user.
    expect(result).toEqual({ ok: false, reason: 'unknown_user' });
    // Important: verify was still called with SOMETHING — the dummy hash —
    // so the wall-clock cost matches the matched-user path.
    expect(verify).toHaveBeenCalledOnce();
    const args = verify.mock.calls[0]!;
    expect(args[0]).not.toBe('$argon2id$real-hash');
  });

  it('treats a verify throw as a non-match', async () => {
    const cfg = makeConfig();
    const verify = vi.fn().mockRejectedValue(new Error('malformed hash'));
    const result = await verifyLocalLogin(cfg, 'admin', 'pw', { verify });
    expect(result.ok).toBe(false);
  });
});
