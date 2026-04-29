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

import { parseStudioConfig, type StudioConfig } from '../src/config/schema.js';

/** Build a valid `StudioConfig` for tests with sensible defaults; pass
 *  `overrides` to vary a specific field. */
export function makeConfig(
  overrides: Partial<{
    rbac: NonNullable<StudioConfig['rbac']>;
    users: { username: string; passwordHash: string; roles: string[] }[];
    cookieSecure: boolean;
    sessionTtlMinutes: number;
  }> = {},
): StudioConfig {
  return parseStudioConfig({
    server: { listen: '127.0.0.1:0' },
    oap: {
      adminUrls: ['http://oap-1:17128'],
      statusUrl: 'http://oap:12800',
    },
    auth: {
      backend: 'local',
      local: {
        users: overrides.users ?? [
          {
            username: 'admin',
            passwordHash: '$argon2id$dummy',
            roles: ['admin'],
          },
        ],
      },
    },
    rbac: overrides.rbac,
    session: {
      ttlMinutes: overrides.sessionTtlMinutes ?? 60,
      cookieName: 'sid',
      cookieSecure: overrides.cookieSecure ?? false,
    },
    audit: { file: '/tmp/vantage-studio-test.jsonl' },
  });
}
