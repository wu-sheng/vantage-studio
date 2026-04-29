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
import { StatusClient } from '../src/status.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('StatusClient.clusterNodes', () => {
  it('normalises both `self` and `isSelf` wire spellings', async () => {
    const fn = vi.fn(async () =>
      jsonResponse({
        nodes: [
          { host: 'oap-1', port: 11800, self: true },
          { host: 'oap-2', port: 11800, isSelf: false },
          { host: 'oap-3', port: 11800 },
        ],
      }),
    );
    const client = new StatusClient({ statusUrl: 'http://oap:12800', fetch: fn });

    const got = await client.clusterNodes();

    expect(got).toHaveLength(3);
    expect(got[0]!.self).toBe(true);
    expect(got[1]!.self).toBe(false);
    expect(got[2]!.self).toBe(false);
  });

  it('hits /status/cluster/nodes on the configured base', async () => {
    const fn = vi.fn(async () => jsonResponse({ nodes: [] }));
    const client = new StatusClient({ statusUrl: 'http://oap:12800/', fetch: fn });

    await client.clusterNodes();

    expect(fn).toHaveBeenCalledWith(
      'http://oap:12800/status/cluster/nodes',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on non-2xx', async () => {
    const fn = vi.fn(async () => new Response('boom', { status: 503 }));
    const client = new StatusClient({ statusUrl: 'http://oap:12800', fetch: fn });

    await expect(client.clusterNodes()).rejects.toThrow(/503/);
  });
});
