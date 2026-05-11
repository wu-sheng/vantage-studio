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
 * Preflight check — interrogates `/debugging/config/dump` on OAP and
 * reports which of Studio's required OAP modules are enabled. The
 * SPA shows a one-time modal at login when any required selector is
 * missing, listing the env var and what UI breaks without it.
 *
 * The dump returns a `Map<String,String>` of dotted keys
 * `<module>.<provider>.<property>`. A module is enabled iff at least
 * one key with its prefix appears in the dump.
 *
 * If admin-server itself is unreachable we return early with
 * `adminReachable: false` and every module marked `enabled: false`;
 * the operator's first move is "check OAP / admin port" rather than
 * "set selectors".
 */

import type { FetchLike } from '@vantage-studio/api-client';
import type { StudioConfig } from '../config/schema.js';

export interface PreflightModule {
  /** OAP module name as it appears in the config-dump key prefix. */
  name: string;
  /** The env var that controls this module's selector. */
  envVar: string;
  /** True when Studio depends on this module being on. */
  required: boolean;
  /** True iff the dump carries at least one key with this module's prefix. */
  enabled: boolean;
  /** What part of Studio's UI breaks when this module is off. */
  affects: string;
}

export interface PreflightResult {
  adminUrl: string;
  /** True iff `/debugging/config/dump` responded 2xx. */
  adminReachable: boolean;
  /** Short reason when `adminReachable` is false. */
  adminError?: string;
  modules: PreflightModule[];
  /** Total keys in the dump. Diagnostic only. */
  dumpKeyCount: number;
  generatedAt: number;
}

interface ModuleDef {
  name: string;
  envVar: string;
  required: boolean;
  affects: string;
}

const REQUIRED_MODULES: readonly ModuleDef[] = [
  {
    name: 'admin-server',
    envVar: 'SW_ADMIN_SERVER',
    required: true,
    affects:
      'Everything Studio does against the admin port. Without admin-server, the other three modules fail at boot with ModuleNotFoundException.',
  },
  {
    name: 'receiver-runtime-rule',
    envVar: 'SW_RECEIVER_RUNTIME_RULE',
    required: true,
    affects:
      "DSL Management (Catalog, OAL catalog), Editor save/load, Cluster status rule matrix, Live debugger rule picker, and the Inspect drawer's source attribution.",
  },
  {
    name: 'dsl-debugging',
    envVar: 'SW_DSL_DEBUGGING',
    required: true,
    affects:
      'Live debugger across MAL / LAL / OAL (start / poll / stop) and the DSL-debugging health pane on Cluster status.',
  },
  {
    name: 'inspect',
    envVar: 'SW_INSPECT',
    required: true,
    affects:
      'The Inspect page — every /api/inspect/* call returns 404 inspect_not_enabled and the page shows a banner instead of the board.',
  },
];

export async function runPreflight(
  config: StudioConfig,
  fetch: FetchLike,
): Promise<PreflightResult> {
  const adminUrl = config.oap.adminUrls[0]!;
  const generatedAt = Date.now();
  const dump = await fetchConfigDump(adminUrl, fetch, config.oap.timeoutMs);

  if (!dump.ok) {
    return {
      adminUrl,
      adminReachable: false,
      adminError: dump.error,
      modules: REQUIRED_MODULES.map((m) => ({
        name: m.name,
        envVar: m.envVar,
        required: m.required,
        affects: m.affects,
        enabled: false,
      })),
      dumpKeyCount: 0,
      generatedAt,
    };
  }

  const keys = Object.keys(dump.body);
  const enabledPrefixes = new Set<string>();
  for (const k of keys) {
    const top = k.split('.', 1)[0];
    if (top) enabledPrefixes.add(top);
  }

  const modules: PreflightModule[] = REQUIRED_MODULES.map((m) => ({
    name: m.name,
    envVar: m.envVar,
    required: m.required,
    affects: m.affects,
    enabled: enabledPrefixes.has(m.name),
  }));

  return {
    adminUrl,
    adminReachable: true,
    modules,
    dumpKeyCount: keys.length,
    generatedAt,
  };
}

interface DumpOk {
  ok: true;
  body: Record<string, string>;
}
interface DumpErr {
  ok: false;
  error: string;
}

async function fetchConfigDump(
  adminUrl: string,
  fetch: FetchLike,
  timeoutMs: number,
): Promise<DumpOk | DumpErr> {
  const url = `${adminUrl.replace(/\/$/, '')}/debugging/config/dump`;
  let init: RequestInit = { method: 'GET', headers: { Accept: 'application/json' } };
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    init = { ...init, signal: ctrl.signal };
  }
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${res.status}${text ? ` — ${text}` : ''}` };
    }
    const body = (await res.json()) as Record<string, string>;
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
