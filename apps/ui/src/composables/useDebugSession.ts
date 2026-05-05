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

import { computed, onScopeDispose, ref, type Ref } from 'vue';
import type {
  PeerInstallAck,
  PriorCleanupOutcome,
  SessionResponse,
  StartSessionArgs,
} from '@vantage-studio/api-client';
import { bff } from '../api/client.js';
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
  const session = ref<SessionResponse | null>(null);
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

  function clearTimer(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll(): void {
    clearTimer();
    const gen = pollGeneration;
    pollTimer = setTimeout(() => {
      void poll(gen);
    }, POLL_INTERVAL_MS);
  }

  async function poll(gen: number): Promise<void> {
    if (gen !== pollGeneration) return;
    const id = sessionId.value;
    if (!id) return;
    try {
      const got = await bff.debugSession(id);
      if (gen !== pollGeneration) return;
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
      error.value = err instanceof Error ? err.message : String(err);
      state.value = 'error';
      clearTimer();
    }
  }

  async function start(args: Omit<StartSessionArgs, 'clientId'>): Promise<void> {
    pollGeneration += 1;
    clearTimer();
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
      error.value = err instanceof Error ? err.message : describeError(err);
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
      error.value = err instanceof Error ? err.message : describeError(err);
      state.value = 'error';
    }
  }

  onScopeDispose(() => {
    pollGeneration += 1;
    clearTimer();
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

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const e = err as { status: number; body: unknown };
    if (typeof e.body === 'object' && e.body !== null) {
      const o = e.body as Record<string, unknown>;
      if (typeof o.code === 'string' && typeof o.message === 'string') {
        return `${e.status} (${o.code}): ${o.message}`;
      }
      if (typeof o.message === 'string') return `${e.status}: ${o.message}`;
    }
    return `HTTP ${e.status}`;
  }
  return String(err);
}
