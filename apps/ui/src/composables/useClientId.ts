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
 * `clientId` mint for the live debugger.
 *
 * SWIP-13 §5 says the UI should mint a stable per-debug-context UUID
 * stored in `sessionStorage` (per-tab) and reuse it across polls.
 * The server enforces "one clientId → at most one active session";
 * a new POST under the same clientId triggers the cluster-scope
 * StopByClientId broadcast that terminates the prior session
 * wherever it lived.
 *
 * One clientId per widget keeps each debugger view (MAL / LAL /
 * OAL) on its own session slot — the operator can have all three
 * open simultaneously.
 */

const STORAGE_PREFIX = 'vantage-studio:debug-clientid:';

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers — adequate for an opaque identifier;
  // not a security context.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns a stable clientId for the given widget key. Persists in
 * sessionStorage (tab-scoped); a new tab gets a fresh id, which is
 * the correct semantics per SWIP-13 (one debug context per tab).
 *
 * If sessionStorage is unavailable (privacy-mode browser, SSR),
 * returns a fresh UUID per call — degraded but functional. A
 * forgetful operator who clicks Start sampling repeatedly under
 * that fallback may consume multiple session slots; the
 * server-side retention timeout reaps them eventually.
 */
export function getClientId(widget: string): string {
  const key = STORAGE_PREFIX + widget;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = makeUuid();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return makeUuid();
  }
}
