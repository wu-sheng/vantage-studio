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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetOn401Handler, bff, setOn401 } from '../src/api/client.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  _resetOn401Handler();
  vi.unstubAllGlobals();
});

describe('BffClient 401 handler dispatch', () => {
  it('invokes the registered handler on a mid-session 401 and rethrows', async () => {
    const onUnauthenticated = vi.fn();
    setOn401(onUnauthenticated);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(bff.catalogList('otel-rules')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke the handler when /api/auth/me returns 401', async () => {
    const onUnauthenticated = vi.fn();
    setOn401(onUnauthenticated);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );

    // me() returns null on 401 by design — the bootstrap probe uses
    // it to ask "am I logged in?" without triggering a redirect.
    expect(await bff.me()).toBeNull();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('does NOT invoke the handler when /api/auth/login returns 401 (bad creds)', async () => {
    const onUnauthenticated = vi.fn();
    setOn401(onUnauthenticated);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
      ),
    );

    await expect(bff.login('alice', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('still invokes the handler when getRule (raw fetch path) returns 401', async () => {
    const onUnauthenticated = vi.fn();
    setOn401(onUnauthenticated);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('', {
          status: 401,
          headers: { 'Content-Type': 'application/x-yaml' },
        }),
      ),
    );

    await expect(bff.getRule({ catalog: 'otel-rules', name: 'vm' })).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no handler is registered', async () => {
    // _resetOn401Handler from afterEach sets handler to null.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(bff.catalogList()).rejects.toMatchObject({ status: 401 });
    // No assertion on a handler — just verifying no throw and the
    // 401 still propagates.
  });

  it('passes 200 responses through unaffected', async () => {
    const onUnauthenticated = vi.fn();
    setOn401(onUnauthenticated);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ generatedAt: 1, loaderStats: { active: 0, pending: 0 }, rules: [] }),
      ),
    );

    const env = await bff.catalogList('otel-rules');
    expect(env.rules).toEqual([]);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
