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
 * In-memory session store. Single-process, single-replica: a `Map`
 * keyed by an opaque 32-byte session id. Sessions are lost on restart;
 * for an operator tool that's the right trade-off (re-login is rare,
 * stateless-JWT machinery is overkill, server-side logout actually
 * works).
 */

import { randomBytes } from 'node:crypto';

export interface Session {
  sid: string;
  username: string;
  roles: readonly string[];
  /** Epoch ms — strictly past `Date.now()` means expired. */
  expiresAt: number;
}

export interface SessionStoreOptions {
  /** Override `Date.now` in tests. */
  now?: () => number;
  /** Override the SID generator in tests. */
  randomSid?: () => string;
}

/** Default SID is 32 random bytes encoded base64url — short, opaque,
 *  cookie-safe, ~256 bits of entropy. */
function defaultRandomSid(): string {
  return randomBytes(32).toString('base64url');
}

export class InMemorySessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly randomSid: () => string;

  constructor(opts: SessionStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.randomSid = opts.randomSid ?? defaultRandomSid;
  }

  create(username: string, roles: readonly string[], ttlMs: number): Session {
    const sid = this.randomSid();
    const session: Session = {
      sid,
      username,
      roles,
      expiresAt: this.now() + ttlMs,
    };
    this.sessions.set(sid, session);
    return session;
  }

  /** Returns the session if present and not expired; lazily evicts
   *  expired sessions. */
  get(sid: string): Session | undefined {
    const s = this.sessions.get(sid);
    if (!s) return undefined;
    if (s.expiresAt <= this.now()) {
      this.sessions.delete(sid);
      return undefined;
    }
    return s;
  }

  delete(sid: string): boolean {
    return this.sessions.delete(sid);
  }

  /** Iterate the map and drop expired entries. Returns the eviction
   *  count. Called by the reaper interval. */
  reapExpired(): number {
    const now = this.now();
    let n = 0;
    for (const [sid, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(sid);
        n++;
      }
    }
    return n;
  }

  /** For tests + diagnostics. */
  size(): number {
    return this.sessions.size;
  }
}
