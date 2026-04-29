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
 * BFF client — same-origin `/api/*` calls. The session cookie is
 * `HttpOnly + SameSite=Strict` so we don't manage it manually; we just
 * pass `credentials: 'include'` to keep it on every request.
 *
 * Surface grows with each phase. Auth in phase 4; catalog list in
 * phase 5; editor + cluster + dump come later.
 */

import type {
  ApplyResult,
  BundledEntry,
  Catalog,
  DeleteMode,
  ListEnvelope,
  RuleResponse,
  RuleSource,
} from '@vantage-studio/api-client';

export interface BffMe {
  username: string;
  roles: readonly string[];
  verbs: readonly string[];
  expiresAt: number;
}

export interface BffApiError {
  status: number;
  body: unknown;
}

function isApiError(v: unknown): v is BffApiError {
  return typeof v === 'object' && v !== null && 'status' in v && 'body' in v;
}

export class BffClient {
  constructor(private readonly base: string = '') {}

  async login(username: string, password: string): Promise<BffMe> {
    return this.request<BffMe>('POST', '/api/auth/login', { username, password });
  }

  async logout(): Promise<void> {
    await this.request<void>('POST', '/api/auth/logout');
  }

  /** Returns null when the response is 401, the user-facing way to ask
   *  "am I logged in?" without throwing. */
  async me(): Promise<BffMe | null> {
    try {
      return await this.request<BffMe>('GET', '/api/auth/me');
    } catch (err) {
      if (isApiError(err) && err.status === 401) return null;
      throw err;
    }
  }

  /** `GET /api/catalog/list[?catalog=]` — proxied envelope from OAP's
   *  `/runtime/rule/list`. Each row carries enough fields for badges
   *  (`bundled`, `bundledContentHash`, `contentHash`) so no second
   *  call is needed for the catalog browse. */
  async catalogList(catalog?: Catalog): Promise<ListEnvelope> {
    const path = catalog
      ? `/api/catalog/list?catalog=${encodeURIComponent(catalog)}`
      : '/api/catalog/list';
    return this.request<ListEnvelope>('GET', path);
  }

  /** `GET /api/rule?catalog=&name=[&source=]` — fetches the YAML body
   *  + metadata headers, normalised into a {@link RuleResponse}.
   *  Returns `null` when OAP responds 404 (rule doesn't exist
   *  anywhere). Throws BffApiError for other non-2xx. */
  async getRule(args: {
    catalog: Catalog;
    name: string;
    source?: RuleSource;
  }): Promise<RuleResponse | null> {
    const params = new URLSearchParams({
      catalog: args.catalog,
      name: args.name,
    });
    if (args.source) params.set('source', args.source);
    const path = `/api/rule?${params.toString()}`;

    const res = await fetch(this.base + path, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/x-yaml' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res);
    const content = await res.text();
    return {
      status: (res.headers.get('x-sw-status') as RuleResponse['status']) ?? 'n/a',
      source: (res.headers.get('x-sw-source') as RuleResponse['source']) ?? 'runtime',
      contentHash: res.headers.get('x-sw-content-hash') ?? '',
      updateTime: Number(res.headers.get('x-sw-update-time') ?? '0'),
      etag: res.headers.get('etag') ?? '',
      content,
    };
  }

  /** `POST /api/rule?catalog=&name=[&allowStorageChange=][&force=]`. */
  async saveRule(args: {
    catalog: Catalog;
    name: string;
    body: string;
    allowStorageChange?: boolean;
    force?: boolean;
  }): Promise<ApplyResult> {
    const params = new URLSearchParams({
      catalog: args.catalog,
      name: args.name,
    });
    if (args.allowStorageChange) params.set('allowStorageChange', 'true');
    if (args.force) params.set('force', 'true');
    const res = await fetch(`${this.base}/api/rule?${params.toString()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: args.body,
    });
    if (!res.ok) throw await this.toError(res);
    return (await res.json()) as ApplyResult;
  }

  /** `POST /api/rule/inactivate?catalog=&name=` */
  async inactivateRule(catalog: Catalog, name: string): Promise<ApplyResult> {
    const params = new URLSearchParams({ catalog, name });
    return this.request<ApplyResult>('POST', `/api/rule/inactivate?${params.toString()}`);
  }

  /** `POST /api/rule/delete?catalog=&name=[&mode=revertToBundled]` */
  async deleteRule(catalog: Catalog, name: string, mode: DeleteMode = ''): Promise<ApplyResult> {
    const params = new URLSearchParams({ catalog, name });
    if (mode) params.set('mode', mode);
    return this.request<ApplyResult>('POST', `/api/rule/delete?${params.toString()}`);
  }

  /** `GET /api/catalog/bundled?catalog=` */
  async catalogBundled(catalog: Catalog, withContent = true): Promise<BundledEntry[]> {
    const params = new URLSearchParams({
      catalog,
      withContent: String(withContent),
    });
    return this.request<BundledEntry[]>('GET', `/api/catalog/bundled?${params.toString()}`);
  }

  private async toError(res: Response): Promise<BffApiError> {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = await res.text();
    }
    return { status: res.status, body: parsed };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    const res = await fetch(this.base + path, init);
    if (res.status === 204) {
      return undefined as T;
    }
    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        parsed = await res.text();
      }
      const err: BffApiError = { status: res.status, body: parsed };
      throw err;
    }
    return (await res.json()) as T;
  }
}

/** Module-level singleton — every component uses the same instance. */
export const bff = new BffClient();
