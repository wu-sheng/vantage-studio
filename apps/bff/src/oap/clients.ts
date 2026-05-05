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
 * Construct OAP API clients on demand. Per-request construction is fine
 * — the clients are thin classes with no per-instance state worth
 * pooling. The factory exists so tests can inject a stub fetch and so
 * config hot-reload picks up new admin URLs without restart.
 */

import {
  DslDebuggingClient,
  OalClient,
  RuntimeRuleClient,
  StatusClient,
  type FetchLike,
} from '@vantage-studio/api-client';
import type { StudioConfig } from '../config/schema.js';

export interface OapClients {
  /** Build a runtime-rule client for one specific admin URL — used
   *  by the cluster fan-out, which talks to every URL. */
  forUrl(adminUrl: string): RuntimeRuleClient;
  /** Convenience — runtime-rule client for the *first* admin URL,
   *  used for reads and for writes (OAP's forward-RPC handles peer
   *  convergence). */
  primary(): RuntimeRuleClient;
  /** Status / cluster-discovery client — port 12800. */
  status(): StatusClient;
  /** OAL read-only management client for the *first* admin URL.
   *  OAL listing is per-node and identical across nodes (modulo
   *  binary-version drift, which is operator deployment discipline);
   *  the BFF doesn't fan-out for the catalog browse. */
  oal(): OalClient;
  /** DSL-debugging client for the *first* admin URL. Session install
   *  and collect both fan-out internally on the OAP side; Studio
   *  hits one node and lets OAP do the cluster work. */
  debug(): DslDebuggingClient;
  /** Build a DSL-debugging client for one specific admin URL — used
   *  by the per-node fan-out for `/dsl-debugging/status`. */
  debugForUrl(adminUrl: string): DslDebuggingClient;
  /** All admin URLs, in config order. */
  adminUrls(): readonly string[];
}

export interface BuildOapClientsOptions {
  fetch?: FetchLike;
}

export function buildOapClients(
  config: StudioConfig,
  opts: BuildOapClientsOptions = {},
): OapClients {
  const fetch = opts.fetch;
  const primaryUrl = config.oap.adminUrls[0]!;
  return {
    forUrl(adminUrl: string): RuntimeRuleClient {
      return new RuntimeRuleClient({ adminUrl, fetch });
    },
    primary(): RuntimeRuleClient {
      return new RuntimeRuleClient({ adminUrl: primaryUrl, fetch });
    },
    status(): StatusClient {
      return new StatusClient({ statusUrl: config.oap.statusUrl, fetch });
    },
    oal(): OalClient {
      return new OalClient({ adminUrl: primaryUrl, fetch });
    },
    debug(): DslDebuggingClient {
      return new DslDebuggingClient({ adminUrl: primaryUrl, fetch });
    },
    debugForUrl(adminUrl: string): DslDebuggingClient {
      return new DslDebuggingClient({ adminUrl, fetch });
    },
    adminUrls(): readonly string[] {
      return config.oap.adminUrls;
    },
  };
}
