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
 * Local-config authentication backend. Verifies credentials against
 * the user list in studio.yaml using argon2id.
 *
 * To resist user-enumeration via timing, we always run an argon2 verify
 * on a constant dummy hash when the username doesn't match a real user.
 * The wall-clock cost of a successful and a failed login should be the
 * same to within the noise of one verify.
 */

import argon2 from 'argon2';
import type { StudioConfig, StudioLocalUser } from '../config/schema.js';

/**
 * A pre-computed argon2id hash of an unguessable string, used to
 * "verify" the password when no user is found. Pre-computed at module
 * load to avoid importing the cost into the first request.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$tNjwoo7iQfKHpEaB4hTk1g$qDlw1zrKLRrR1H1XFf+iQ4UPibqXYrqJfDt9OaVVnEQ';

export interface LoginOk {
  ok: true;
  user: StudioLocalUser;
}

export interface LoginFail {
  ok: false;
  reason: 'unknown_user' | 'bad_password';
}

export type LoginResult = LoginOk | LoginFail;

export interface VerifyDeps {
  /** Override argon2.verify in tests. */
  verify?: (hash: string, password: string) => Promise<boolean>;
}

export async function verifyLocalLogin(
  config: StudioConfig,
  username: string,
  password: string,
  deps: VerifyDeps = {},
): Promise<LoginResult> {
  const verify = deps.verify ?? ((h, p) => argon2.verify(h, p));

  const user = config.auth.local.users.find((u) => u.username === username);
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH;

  let match: boolean;
  try {
    match = await verify(hashToCheck, password);
  } catch {
    // argon2.verify throws on a malformed hash. Treat as a non-match.
    match = false;
  }

  if (!user) {
    // Always 'unknown_user' regardless of `match` — the dummy verify is
    // for timing alone, never a successful auth.
    return { ok: false, reason: 'unknown_user' };
  }
  if (!match) {
    return { ok: false, reason: 'bad_password' };
  }
  return { ok: true, user };
}
