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
 * `/api/debug/*` routes — passthrough proxy for SWIP-13's
 * DSL-debugging surface. Six handlers:
 *
 *   POST /api/debug/session          — start (audit start)
 *   GET  /api/debug/session/:id      — poll (no audit)
 *   POST /api/debug/session/:id/stop — stop  (audit stop)
 *   GET  /api/debug/sessions         — list active
 *   GET  /api/debug/status           — per-cluster fan-out
 *
 * The `clientId` is minted client-side per browser tab/widget; BFF
 * forwards it verbatim. SWIP §5 specifies a cluster-scope
 * `StopByClientId` broadcast on every session start, so a load-
 * balancer routing the next start to a different node still cleans
 * up the prior session correctly.
 *
 * RBAC verb is `rule:debug`. Audit logs `start` and `stop` events;
 * polling and listing are not audited.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RuntimeRuleApiError,
  isDebugCatalog,
  type DebugCatalog,
  type DslDebuggingStatus,
  type Granularity,
  type LalBlock,
  type StartSessionArgs,
} from '@vantage-studio/api-client';
import type { ConfigHandle } from '../config/loader.js';
import type { AuditLogger } from '../audit/logger.js';
import { requireAuth } from '../auth/middleware.js';
import { sessionHasVerb } from '../rbac/policy.js';
import type { Session } from '../auth/sessions.js';
import type { InMemorySessionStore } from '../auth/sessions.js';
import { buildOapClients, type OapClients } from './clients.js';
import type { FetchLike } from '@vantage-studio/api-client';

export interface DebugRouteDeps {
  config: ConfigHandle;
  sessions: InMemorySessionStore;
  audit: AuditLogger;
  fetch?: FetchLike;
}

/** Per-node `/dsl-debugging/status` slice — keyed by admin URL. */
export interface ClusterDebugStatus {
  generatedAt: number;
  nodes: { url: string; ok: boolean; status?: DslDebuggingStatus; error?: string }[];
}

const VALID_GRANULARITY = new Set<Granularity>(['block', 'statement']);
const VALID_LAL_BLOCKS = new Set<LalBlock>([
  'text',
  'parser',
  'extractor',
  'sink',
  'output_record',
  'output_metric',
]);

export function registerDebugRoutes(app: FastifyInstance, deps: DebugRouteDeps): void {
  const auth = requireAuth(deps);

  function clients(): OapClients {
    return buildOapClients(deps.config.current(), { fetch: deps.fetch });
  }

  // ── start session ────────────────────────────────────────────────
  app.post(
    '/api/debug/session',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:debug')) return;
      const parsed = parseStartArgs(req.body, reply);
      if (!parsed) return;
      try {
        const result = await clients().debug().startSession(parsed);
        deps.audit.log({
          action: 'debug.start',
          verb: 'rule:debug',
          actor: req.session?.username ?? null,
          outcome: 'ok',
          details: {
            sessionId: result.sessionId,
            clientId: parsed.clientId,
            catalog: parsed.catalog,
            name: parsed.name,
            ruleName: parsed.ruleName,
            granularity: parsed.granularity,
            replacedPriorId: result.replacedPriorId,
            replacedPriorIds: result.replacedPriorIds,
          },
          fromIp: req.ip,
          sessionId: req.session?.sid,
        });
        return reply.send(result);
      } catch (err) {
        deps.audit.log({
          action: 'debug.start',
          verb: 'rule:debug',
          actor: req.session?.username ?? null,
          outcome: outcomeOf(err),
          details: {
            clientId: parsed.clientId,
            catalog: parsed.catalog,
            name: parsed.name,
            ruleName: parsed.ruleName,
          },
          fromIp: req.ip,
          sessionId: req.session?.sid,
        });
        return passOapError(err, reply);
      }
    },
  );

  // ── poll session ─────────────────────────────────────────────────
  app.get(
    '/api/debug/session/:id',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:debug')) return;
      const params = req.params as { id: string };
      if (!params.id) return reply.code(400).send({ error: 'missing_id' });
      try {
        const got = await clients().debug().getSession(params.id);
        if (got === null) return reply.code(404).send({ error: 'not_found' });
        return reply.send(got);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  // ── stop session ─────────────────────────────────────────────────
  app.post(
    '/api/debug/session/:id/stop',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:debug')) return;
      const params = req.params as { id: string };
      if (!params.id) return reply.code(400).send({ error: 'missing_id' });
      try {
        await clients().debug().stopSession(params.id);
        deps.audit.log({
          action: 'debug.stop',
          verb: 'rule:debug',
          actor: req.session?.username ?? null,
          outcome: 'ok',
          details: { sessionId: params.id },
          fromIp: req.ip,
          sessionId: req.session?.sid,
        });
        return reply.code(204).send();
      } catch (err) {
        deps.audit.log({
          action: 'debug.stop',
          verb: 'rule:debug',
          actor: req.session?.username ?? null,
          outcome: outcomeOf(err),
          details: { sessionId: params.id },
          fromIp: req.ip,
          sessionId: req.session?.sid,
        });
        return passOapError(err, reply);
      }
    },
  );

  // ── list active sessions ─────────────────────────────────────────
  app.get(
    '/api/debug/sessions',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'rule:debug')) return;
      try {
        const list = await clients().debug().listSessions();
        return reply.send(list);
      } catch (err) {
        return passOapError(err, reply);
      }
    },
  );

  // ── per-cluster status fan-out ───────────────────────────────────
  // GET /dsl-debugging/status is a per-node read; for the cluster
  // status pane Studio fans out across `oap.adminUrls` and reports
  // per-node posture, mirroring the runtime-rule cluster matrix.
  app.get(
    '/api/debug/status',
    { preHandler: auth },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!ensureVerb(req, reply, deps, 'cluster:read')) return;
      const c = clients();
      const nodes = await Promise.all(
        c.adminUrls().map(async (url) => {
          try {
            const status = await c.debugForUrl(url).getStatus();
            return { url, ok: true as const, status };
          } catch (err) {
            return {
              url,
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      const body: ClusterDebugStatus = { generatedAt: Date.now(), nodes };
      return reply.send(body);
    },
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function ensureVerb(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: DebugRouteDeps,
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

function parseStartArgs(raw: unknown, reply: FastifyReply): StartSessionArgs | null {
  if (typeof raw !== 'object' || raw === null) {
    reply.code(400).send({ error: 'invalid_body' });
    return null;
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.clientId !== 'string' || b.clientId.length === 0) {
    reply.code(400).send({ error: 'missing_clientId' });
    return null;
  }
  if (typeof b.catalog !== 'string' || !isDebugCatalog(b.catalog)) {
    reply.code(400).send({ error: 'invalid_catalog', value: b.catalog });
    return null;
  }
  if (typeof b.name !== 'string' || b.name.length === 0) {
    reply.code(400).send({ error: 'missing_name' });
    return null;
  }
  const catalog = b.catalog as DebugCatalog;
  // OAL requires ruleName; MAL/LAL forbid it (per SWIP §4.2).
  if (catalog === 'oal') {
    if (typeof b.ruleName !== 'string' || b.ruleName.length === 0) {
      reply.code(400).send({ error: 'missing_ruleName_for_oal' });
      return null;
    }
  } else if (b.ruleName !== undefined && b.ruleName !== null) {
    reply.code(400).send({ error: 'ruleName_only_for_oal' });
    return null;
  }

  const out: StartSessionArgs = {
    clientId: b.clientId,
    catalog,
    name: b.name,
  };
  if (catalog === 'oal' && typeof b.ruleName === 'string') out.ruleName = b.ruleName;

  if (b.maxRecords !== undefined) {
    if (typeof b.maxRecords !== 'number' || !Number.isFinite(b.maxRecords) || b.maxRecords <= 0) {
      reply.code(400).send({ error: 'invalid_maxRecords' });
      return null;
    }
    out.maxRecords = b.maxRecords;
  }
  if (b.windowSec !== undefined) {
    if (typeof b.windowSec !== 'number' || !Number.isFinite(b.windowSec) || b.windowSec <= 0) {
      reply.code(400).send({ error: 'invalid_windowSec' });
      return null;
    }
    out.windowSec = b.windowSec;
  }
  if (b.granularity !== undefined && b.granularity !== null) {
    if (typeof b.granularity !== 'string' || !VALID_GRANULARITY.has(b.granularity as Granularity)) {
      reply.code(400).send({ error: 'invalid_granularity', value: b.granularity });
      return null;
    }
    if (catalog !== 'lal') {
      reply.code(400).send({ error: 'granularity_only_for_lal' });
      return null;
    }
    out.granularity = b.granularity as Granularity;
  }
  if (b.blocks !== undefined && b.blocks !== null) {
    if (!Array.isArray(b.blocks)) {
      reply.code(400).send({ error: 'invalid_blocks' });
      return null;
    }
    if (catalog !== 'lal') {
      reply.code(400).send({ error: 'blocks_only_for_lal' });
      return null;
    }
    for (const blk of b.blocks) {
      if (typeof blk !== 'string' || !VALID_LAL_BLOCKS.has(blk as LalBlock)) {
        reply.code(400).send({ error: 'invalid_block', value: blk });
        return null;
      }
    }
    out.blocks = b.blocks as LalBlock[];
  }

  return out;
}

function outcomeOf(err: unknown): string {
  if (err instanceof RuntimeRuleApiError) {
    const body = err.body;
    return typeof body === 'object' && body !== null && 'applyStatus' in body
      ? body.applyStatus
      : `http_${err.status}`;
  }
  return 'oap_unreachable';
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
