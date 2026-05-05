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
 * Caller passes a `widget` key (one of `mal`, `lal`, `oal`) plus a
 * computed function returning the spec to start with. The composable:
 *
 *   - mints / reuses a stable clientId per widget (per browser tab),
 *   - sends `POST /api/debug/session` on `start()`,
 *   - polls `GET /api/debug/session/{id}` while CAPTURING (~1 s
 *     interval until terminal), then stops polling,
 *   - exposes `start`, `stop`, `restart`, `session` (the latest
 *     response), `state` (idle | starting | capturing | captured |
 *     stopped | error), and `error`.
 *
 * Polling stops automatically once the server reports a terminal
 * status. The session payload is stable across post-terminal polls
 * per SWIP-13 §5; we keep the latest one rendered.
 */

import { computed, onScopeDispose, ref, type Ref } from 'vue';
import type { SessionResponse, StartSessionArgs } from '@vantage-studio/api-client';
import { bff } from '../api/client.js';
import { getClientId } from './useClientId.js';

export type DebugWidgetKey = 'mal' | 'lal' | 'oal';

export type DebugState =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'captured'
  | 'stopped'
  | 'expired'
  | 'error';

export interface UseDebugSessionResult {
  clientId: string;
  state: Ref<DebugState>;
  session: Ref<SessionResponse | null>;
  sessionId: Ref<string | null>;
  /** Set when state === 'error'. */
  error: Ref<string | null>;
  /** Per-peer install ack list from the most recent start call. */
  peerAcks: Ref<{ nodeId: string; ack: 'ok' | 'install_failed' | 'timeout' }[]>;
  /** Set when the start response reported a prior session was
   *  terminated (cluster-scope StopByClientId footprint). */
  replacedPriorIds: Ref<string[]>;
  /** Allocate a new session. Discards any prior local state. */
  start(args: Omit<StartSessionArgs, 'clientId'>): Promise<void>;
  /** Stop the current session. No-op when idle. */
  stop(): Promise<void>;
}

const POLL_INTERVAL_MS = 1000;

export function useDebugSession(widget: DebugWidgetKey): UseDebugSessionResult {
  const clientId = getClientId(widget);
  const state = ref<DebugState>('idle');
  const session = ref<SessionResponse | null>(null);
  const sessionId = ref<string | null>(null);
  const error = ref<string | null>(null);
  const peerAcks = ref<{ nodeId: string; ack: 'ok' | 'install_failed' | 'timeout' }[]>([]);
  const replacedPriorIds = ref<string[]>([]);

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
        state.value = 'expired';
        clearTimer();
        return;
      }
      session.value = got;
      if (got.status === 'capturing') {
        state.value = 'capturing';
        schedulePoll();
      } else if (got.status === 'captured') {
        state.value = 'captured';
        // SWIP §5: post-CAPTURED polls return identical bytes; one
        // last refresh is enough. Stop polling.
        clearTimer();
      } else {
        // Treat any non-listed status as a terminal idle.
        state.value = 'expired';
        clearTimer();
      }
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
    replacedPriorIds.value = [];

    try {
      const r = await bff.debugStart({ clientId, ...args });
      sessionId.value = r.sessionId;
      peerAcks.value = r.peers ?? [];
      const replaced: string[] = [];
      if (r.replacedPriorId) replaced.push(r.replacedPriorId);
      if (r.replacedPriorIds) replaced.push(...r.replacedPriorIds);
      replacedPriorIds.value = replaced;
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
    replacedPriorIds,
    start,
    stop,
  };
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const e = err as { status: number; body: unknown };
    if (typeof e.body === 'object' && e.body !== null && 'message' in e.body) {
      return `${e.status}: ${(e.body as { message: string }).message}`;
    }
    return `HTTP ${e.status}`;
  }
  return String(err);
}
