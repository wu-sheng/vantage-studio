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
 * Reactive lifecycle wrapper around `/api/debug/*`.
 *
 * The actual wire (see `reference_swip13_actual_wire.md`) doesn't have a
 * top-level session status — `nodes[].status` is per-node and the
 * recorder's `captured` boolean signals "session frozen". This composable
 * computes a single UI-facing state by combining: install ack, every
 * node's status, and the per-node `captured` flag.
 *
 * UI states:
 *   - idle     — never started
 *   - starting — POST /session in flight
 *   - capturing — at least one node is `status: ok` and not captured
 *   - captured  — every reachable node is captured
 *   - stopped   — operator hit Stop (response received, polling halted)
 *   - error     — start failed
 *
 * Polling cadence: 1 s while `capturing`, then halts on terminal.
 */

import { computed, onScopeDispose, ref, shallowRef, type Ref } from 'vue';
import type {
  PeerInstallAck,
  PriorCleanupOutcome,
  SessionResponse,
  StartSessionArgs,
} from '@vantage-studio/api-client';
import { bff, describeApiError } from '../api/client.js';
import { getClientId } from './useClientId.js';

export type DebugWidgetKey = 'mal' | 'lal' | 'oal';

export type DebugState =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'captured'
  | 'stopped'
  | 'error';

export interface UseDebugSessionResult {
  clientId: string;
  state: Ref<DebugState>;
  session: Ref<SessionResponse | null>;
  sessionId: Ref<string | null>;
  /** Set when state === 'error'. */
  error: Ref<string | null>;
  /** Per-peer install acks from the most recent start call. */
  peerAcks: Ref<PeerInstallAck[]>;
  /** Per-peer cleanup outcomes from the StopByClientId broadcast that
   *  ran before the session was allocated. */
  priorCleanup: Ref<PriorCleanupOutcome[]>;
  /** Convenience flat list of every prior session id that was
   *  terminated by the cleanup, derived from `priorCleanup`. */
  replacedPriorIds: Ref<string[]>;
  /** Allocate a new session. Discards any prior local state. */
  start(args: Omit<StartSessionArgs, 'clientId'>): Promise<void>;
  /** Stop the current session. No-op when idle. */
  stop(): Promise<void>;
}

const POLL_INTERVAL_MS = 1000;
/** Pause polling when the tab is hidden — operator can't see captures
 *  anyway, no reason to keep load on the BFF + OAP. The first
 *  visibilitychange on resume snaps an immediate poll. */
const PAUSE_ON_HIDDEN = true;
/** Tolerate brief OAP / network blips before declaring an error.
 *  Each retry waits POLL_INTERVAL_MS × (attempt + 1) ms. */
const POLL_RETRY_BUDGET = 2;

/** Decide the UI-facing state from a polled SessionResponse. */
function deriveState(resp: SessionResponse): 'capturing' | 'captured' {
  // The wire doesn't have a top-level status; combine per-node flags.
  // If every reachable node is captured (or unreachable / not_local),
  // there's nothing more coming — treat as captured.
  const reachable = resp.nodes.filter(
    (n) => n.status === 'ok' || n.status === 'captured',
  );
  if (reachable.length === 0) {
    // No-one's contributing data; nothing to wait for.
    return 'captured';
  }
  const allCaptured = reachable.every((n) => n.status === 'captured' || n.captured === true);
  return allCaptured ? 'captured' : 'capturing';
}

export function useDebugSession(widget: DebugWidgetKey): UseDebugSessionResult {
  const clientId = getClientId(widget);
  const state = ref<DebugState>('idle');
  // shallowRef: the session response is replaced wholesale per poll
  // and never mutated in place. Deep reactivity over a 1000-record
  // payload would walk every leaf on every poll for no benefit —
  // shallowRef notifies dependents on assignment only.
  const session = shallowRef<SessionResponse | null>(null);
  const sessionId = ref<string | null>(null);
  const error = ref<string | null>(null);
  const peerAcks = ref<PeerInstallAck[]>([]);
  const priorCleanup = ref<PriorCleanupOutcome[]>([]);

  const replacedPriorIds = computed<string[]>(() => {
    const out: string[] = [];
    for (const c of priorCleanup.value) {
      if (c.stoppedSessionIds) out.push(...c.stoppedSessionIds);
    }
    return out;
  });

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollGeneration = 0;
  /** Consecutive failures since the last successful poll. Resets on
   *  every successful response. */
  let pollFailures = 0;
  /** True when polling is on hold because `document.hidden` is true.
   *  An immediate poll fires when the tab becomes visible again. */
  let pausedForHidden = false;

  function clearTimer(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(delay: number = POLL_INTERVAL_MS): void {
    clearTimer();
    if (PAUSE_ON_HIDDEN && typeof document !== 'undefined' && document.hidden) {
      pausedForHidden = true;
      return;
    }
    const gen = pollGeneration;
    pollTimer = setTimeout(() => {
      void poll(gen);
    }, delay);
  }

  async function poll(gen: number): Promise<void> {
    if (gen !== pollGeneration) return;
    const id = sessionId.value;
    if (!id) return;
    try {
      const got = await bff.debugSession(id);
      if (gen !== pollGeneration) return;
      pollFailures = 0;
      if (got === null) {
        // Session went past retention; freeze whatever we last saw and
        // surface as captured (we kept the last poll's records).
        state.value = 'captured';
        clearTimer();
        return;
      }
      session.value = got;
      const next = deriveState(got);
      state.value = next;
      if (next === 'capturing') schedulePoll();
      else clearTimer();
    } catch (err) {
      if (gen !== pollGeneration) return;
      pollFailures += 1;
      if (pollFailures <= POLL_RETRY_BUDGET) {
        // Exponential-ish backoff while the blip clears. Don't surface
        // the error in the UI — operator sees uninterrupted capturing.
        schedulePoll(POLL_INTERVAL_MS * (pollFailures + 1));
        return;
      }
      error.value = describeApiError(err);
      state.value = 'error';
      clearTimer();
    }
  }

  async function start(args: Omit<StartSessionArgs, 'clientId'>): Promise<void> {
    pollGeneration += 1;
    clearTimer();
    pollFailures = 0;
    pausedForHidden = false;
    state.value = 'starting';
    error.value = null;
    session.value = null;
    sessionId.value = null;
    peerAcks.value = [];
    priorCleanup.value = [];

    try {
      const r = await bff.debugStart({ clientId, ...args });
      sessionId.value = r.sessionId;
      peerAcks.value = r.peers ?? [];
      priorCleanup.value = r.priorCleanup ?? [];
      state.value = 'capturing';
      // First poll immediately so the operator sees something fast.
      void poll(pollGeneration);
    } catch (err) {
      error.value = describeApiError(err);
      state.value = 'error';
    }
  }

  async function stop(): Promise<void> {
    pollGeneration += 1;
    clearTimer();
    const id = sessionId.value;
    if (!id) {
      state.value = 'idle';
      return;
    }
    try {
      await bff.debugStop(id);
      state.value = 'stopped';
      // Refresh once so the post-stop "not_local" status surfaces in
      // the UI.
      try {
        const after = await bff.debugSession(id);
        if (after !== null) session.value = after;
      } catch {
        // ignore — stop already succeeded.
      }
    } catch (err) {
      error.value = describeApiError(err);
      state.value = 'error';
    }
  }

  function onVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      // Going hidden — clear the timer; the next schedulePoll will
      // park itself in pausedForHidden until we come back.
      clearTimer();
    } else if (pausedForHidden && state.value === 'capturing') {
      // Resume: snap an immediate poll so the operator sees fresh
      // data on tab focus.
      pausedForHidden = false;
      void poll(pollGeneration);
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  onScopeDispose(() => {
    pollGeneration += 1;
    clearTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return {
    clientId,
    state,
    session,
    sessionId: computed(() => sessionId.value) as Ref<string | null>,
    error,
    peerAcks,
    priorCleanup,
    replacedPriorIds,
    start,
    stop,
  };
}
