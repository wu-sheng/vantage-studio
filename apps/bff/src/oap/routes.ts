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
 * Studio's `/api/*` surface — eight route families that together cover
 * everything v1's catalog browse, editor, cluster matrix, and dump UIs
 * need.
 *
 * Each handler:
 *   1. Runs through `requireAuth` (handled by route preHandler).
 *   2. Resolves the verb required for this call.
 *   3. Calls the OAP client, mapping errors back to HTTP via the
 *      `RuntimeRuleApiError` envelope so OAP's applyStatus codes
 *      reach the SPA verbatim.
 *   4. Audits every mutating call, with the actor / verb / outcome.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RuntimeRuleApiError,
  isCatalog,
  type Catalog,
  type DeleteMode,
} from '@vantage-studio/api-client';
import type { ConfigHandle } from '../config/loader.js';
import type { AuditLogger } from '../audit/logger.js';
import { requireAuth } from '../auth/middleware.js';
import { sessionHasVerb } from '../rbac/policy.js';
import type { Session } from '../auth/sessions.js';
import type { InMemorySessionStore } from '../auth/sessions.js';
import { buildOapClients, type OapClients } from './clients.js';
import { fetchPerNode, pivotClusterState } from './cluster.js';
import type { FetchLike } from '@vantage-studio/api-client';

export interface OapRouteDeps {
  config: ConfigHandle;
  sessions: InMemorySessionStore;
  audit: AuditLogger;
  /** Test seam — replaces `globalThis.fetch` in every OAP call. */
  fetch?: FetchLike;
}

const TRUTHY = new Set(['true', '1', 'yes']);

/** Register every `/api/*` route on the given Fastify instance. The
 *  text/plain content-type parser must already be registered (see
 *  server.ts). */
export function registerOapRoutes(app: FastifyInstance, deps: OapRouteDeps): void {
  const auth = requireAuth(deps);

  function clients(): OapClients {
    return buildOapClients(deps.config.current(), { fetch: deps.fetch });
  }

  // ── catalog browse ────────────────────────────────────────────────

  app.get(
    '/api/catalog/list',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      const catalog = parseOptionalCatalog(req.query, reply);
      if (catalog === undefined && hasCatalogParam(req.query)) return;
      try {
        const env = await clients().primary().list(catalog);
        return reply.send(env);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  app.get(
    '/api/catalog/bundled',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      const catalog = parseRequiredCatalog(req.query, reply);
      if (!catalog) return;
      const withContent = parseBoolean((req.query as Record<string, string>).withContent, true);
      try {
        const list = await clients().primary().listBundled(catalog, withContent);
        return reply.send(list);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  // ── single rule fetch ─────────────────────────────────────────────

  app.get('/api/rule', { preHandler: auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!ensureVerb(req, reply, deps, 'rule:read')) return;
    const q = req.query as Record<string, string | undefined>;
    const catalog = parseRequiredCatalog(q, reply);
    if (!catalog) return;
    if (!q.name) {
      return reply.code(400).send({ error: 'missing_name' });
    }
    const source = q.source as 'runtime' | 'bundled' | undefined;
    if (source !== undefined && source !== 'runtime' && source !== 'bundled') {
      return reply.code(400).send({ error: 'invalid_source', value: source });
    }
    const ifNoneMatch = req.headers['if-none-match'] as string | undefined;
    try {
      const got = await clients()
        .primary()
        .get({
          catalog,
          name: q.name,
          ...(source !== undefined ? { source } : {}),
          ...(ifNoneMatch !== undefined ? { ifNoneMatch } : {}),
        });
      if ('notModified' in got) {
        reply.header('etag', got.etag);
        reply.header('x-sw-content-hash', got.contentHash);
        reply.header('x-sw-status', got.status);
        return reply.code(304).send();
      }
      reply.header('content-type', 'application/x-yaml; charset=utf-8');
      reply.header('etag', got.etag);
      reply.header('x-sw-content-hash', got.contentHash);
      reply.header('x-sw-status', got.status);
      reply.header('x-sw-source', got.source);
      reply.header('x-sw-update-time', String(got.updateTime));
      return reply.send(got.content);
    } catch (err) {
      return passOapError(err, reply);
    }
  });

  // ── write paths (audit on every call) ─────────────────────────────

  app.post('/api/rule', { preHandler: auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    const catalog = parseRequiredCatalog(q, reply);
    if (!catalog) return;
    if (!q.name) return reply.code(400).send({ error: 'missing_name' });
    if (typeof req.body !== 'string' || req.body.length === 0) {
      return reply.code(400).send({ error: 'empty_body' });
    }
    const allowStorageChange = parseBoolean(q.allowStorageChange, false);
    const force = parseBoolean(q.force, false);
    const verb = allowStorageChange || force ? 'rule:write:structural' : 'rule:write';
    if (!ensureVerb(req, reply, deps, verb)) return;

    try {
      const result = await clients().primary().addOrUpdate({
        catalog,
        name: q.name,
        body: req.body,
        allowStorageChange,
        force,
      });
      auditMutation(deps, req, 'addOrUpdate', verb, catalog, q.name, result.applyStatus, {
        allowStorageChange,
        force,
      });
      return reply.send(result);
    } catch (err) {
      return passOapErrorAudit(err, reply, deps, req, 'addOrUpdate', verb, catalog, q.name);
    }
  });

  app.post(
    '/api/rule/inactivate',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const catalog = parseRequiredCatalog(q, reply);
      if (!catalog) return;
      if (!q.name) return reply.code(400).send({ error: 'missing_name' });
      if (!ensureVerb(req, reply, deps, 'rule:write')) return;
      try {
        const result = await clients().primary().inactivate(catalog, q.name);
        auditMutation(deps, req, 'inactivate', 'rule:write', catalog, q.name, result.applyStatus);
        return reply.send(result);
      } catch (err) {
        return passOapErrorAudit(
          err,
          reply,
          deps,
          req,
          'inactivate',
          'rule:write',
          catalog,
          q.name,
        );
      }
    },
  );

  app.post(
    '/api/rule/delete',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string, string | undefined>;
      const catalog = parseRequiredCatalog(q, reply);
      if (!catalog) return;
      if (!q.name) return reply.code(400).send({ error: 'missing_name' });
      const mode = parseDeleteMode(q.mode, reply);
      if (mode === null) return;
      if (!ensureVerb(req, reply, deps, 'rule:delete')) return;
      try {
        const result = await clients().primary().delete(catalog, q.name, mode);
        auditMutation(deps, req, 'delete', 'rule:delete', catalog, q.name, result.applyStatus, {
          mode,
        });
        return reply.send(result);
      } catch (err) {
        return passOapErrorAudit(err, reply, deps, req, 'delete', 'rule:delete', catalog, q.name, {
          mode,
        });
      }
    },
  );

  // ── cluster state (BFF fan-out) ───────────────────────────────────

  app.get(
    '/api/cluster/state',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'cluster:read')) return;
      const c = clients();
      const perNode = await fetchPerNode(c);
      return reply.send(pivotClusterState(perNode));
    },
  );

  // ── dump (streaming passthrough) ──────────────────────────────────

  const dumpHandler = (catalog: Catalog | null) =>
    async function (req: FastifyRequest, reply: FastifyReply) {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      try {
        const upstream = await clients()
          .primary()
          .dump(catalog ?? undefined);
        const ct = upstream.headers.get('content-type') ?? 'application/octet-stream';
        const cd = upstream.headers.get('content-disposition');
        reply.header('content-type', ct);
        if (cd) reply.header('content-disposition', cd);
        return reply.send(upstream.body ?? '');
      } catch (err) {
        return passOapError(err, reply);
      }
    };

  app.get('/api/dump', { preHandler: auth }, dumpHandler(null));

  app.get(
    '/api/dump/:catalog',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { catalog: string };
      if (!isCatalog(params.catalog)) {
        return reply.code(400).send({ error: 'invalid_catalog', value: params.catalog });
      }
      return dumpHandler(params.catalog)(req, reply);
    },
  );

  // ── OAL read-only browse (SWIP-13 §4.1) ──────────────────────────
  // Read-only — no audit. `rule:read` gate.
  //
  // Wire shape from RuntimeOalRestHandler.java:
  //   /files          — { files: string[], count }
  //   /files/{name}   — text/plain raw .oal content
  //   /rules          — per-dispatcher listing { sources, count }
  //   /rules/{source} — single source detail with `status: live | no_holder`

  app.get(
    '/api/oal/files',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      try {
        const list = await clients().oal().listFiles();
        return reply.send(list);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  app.get(
    '/api/oal/files/:name',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      const params = req.params as { name: string };
      if (!params.name) return reply.code(400).send({ error: 'missing_name' });
      try {
        const content = await clients().oal().getFileContent(params.name);
        if (content === null) return reply.code(404).send({ error: 'not_found' });
        reply.header('content-type', 'text/plain; charset=utf-8');
        return reply.send(content);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  app.get(
    '/api/oal/rules',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      try {
        const sources = await clients().oal().listSources();
        return reply.send(sources);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  app.get(
    '/api/oal/rules/:source',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:read')) return;
      const params = req.params as { source: string };
      if (!params.source) return reply.code(400).send({ error: 'missing_source' });
      try {
        const detail = await clients().oal().getSource(params.source);
        if (detail === null) return reply.code(404).send({ error: 'not_found' });
        return reply.send(detail);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function parseBoolean(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return TRUTHY.has(v.toLowerCase());
}

function hasCatalogParam(q: unknown): boolean {
  return typeof q === 'object' && q !== null && 'catalog' in q;
}

/** When the `catalog` query is missing, returns `undefined` and lets
 *  the caller proceed. When present-but-invalid, sends 400 and returns
 *  `undefined`; the caller should check `hasCatalogParam` to disambiguate. */
function parseOptionalCatalog(q: unknown, reply: FastifyReply): Catalog | undefined {
  const raw = (q as Record<string, string | undefined>).catalog;
  if (raw === undefined || raw === '') return undefined;
  if (!isCatalog(raw)) {
    reply.code(400).send({ error: 'invalid_catalog', value: raw });
    return undefined;
  }
  return raw;
}

function parseRequiredCatalog(q: unknown, reply: FastifyReply): Catalog | null {
  const raw = (q as Record<string, string | undefined>).catalog;
  if (!raw) {
    reply.code(400).send({ error: 'missing_catalog' });
    return null;
  }
  if (!isCatalog(raw)) {
    reply.code(400).send({ error: 'invalid_catalog', value: raw });
    return null;
  }
  return raw;
}

/** Returns the parsed `DeleteMode` or `null` when the wire value was
 *  invalid (and a 400 was sent). */
function parseDeleteMode(raw: string | undefined, reply: FastifyReply): DeleteMode | null {
  if (raw === undefined || raw === '') return '';
  if (raw === 'revertToBundled') return 'revertToBundled';
  reply.code(400).send({ error: 'invalid_delete_mode', value: raw });
  return null;
}

function ensureVerb(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: OapRouteDeps,
  verb: string,
): boolean {
  const session: Session | undefined = req.session;
  if (!session) {
    reply.code(401).send({ error: 'unauthenticated' });
    return false;
  }
  if (!sessionHasVerb(deps.config.current(), session.roles, verb)) {
    reply.code(403).send({ error: 'permission_denied', verb });
    return false;
  }
  return true;
}

function passOapError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof RuntimeRuleApiError) {
    return reply.code(err.status).send(err.body);
  }
  return reply.code(502).send({
    error: 'oap_unreachable',
    message: err instanceof Error ? err.message : String(err),
  });
}

function passOapErrorAudit(
  err: unknown,
  reply: FastifyReply,
  deps: OapRouteDeps,
  req: FastifyRequest,
  action: string,
  verb: string,
  catalog: Catalog,
  name: string,
  details: Record<string, unknown> = {},
): FastifyReply {
  let outcome = 'oap_unreachable';
  if (err instanceof RuntimeRuleApiError) {
    const apiErr: RuntimeRuleApiError = err;
    const body = apiErr.body;
    outcome =
      typeof body === 'object' && body !== null && 'applyStatus' in body
        ? body.applyStatus
        : `http_${apiErr.status}`;
  }
  deps.audit.log({
    action,
    verb,
    actor: req.session?.username ?? null,
    outcome,
    details: { catalog, name, ...details },
    fromIp: req.ip,
    sessionId: req.session?.sid,
  });
  return passOapError(err, reply);
}

function auditMutation(
  deps: OapRouteDeps,
  req: FastifyRequest,
  action: string,
  verb: string,
  catalog: Catalog,
  name: string,
  outcome: string,
  details: Record<string, unknown> = {},
): void {
  deps.audit.log({
    action,
    verb,
    actor: req.session?.username ?? null,
    outcome,
    details: { catalog, name, ...details },
    fromIp: req.ip,
    sessionId: req.session?.sid,
  });
}
