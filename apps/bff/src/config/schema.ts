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
 * Zod schema for studio.yaml — the only piece of state the BFF reads
 * besides in-memory sessions and the audit JSONL. Hot-reloaded via
 * chokidar; an invalid file leaves the previous good config in place.
 *
 * RBAC is **optional**: if the `rbac` block is absent (or
 * `rbac.enabled: false`), every authenticated user has full access.
 */

import { z } from 'zod';

/** Username pattern — Unix-shape, conservative on purpose. */
const Username = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, 'username must match [A-Za-z0-9._-]+');

const RoleName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'role name must match [A-Za-z0-9._:-]+');

/** Verb pattern — `domain:action[:qualifier]` plus the bare wildcard
 *  `*`. Matches the verb table in `project_tech_stack.md`. */
const Verb = z
  .string()
  .regex(
    /^(\*|[a-z][a-z0-9]*(?::[a-z][a-z0-9]*){1,2})$/,
    'verb must be "*" or a "domain:action[:qualifier]" string',
  );

/** Network listen target, e.g. `0.0.0.0:8080` or `127.0.0.1:8080`. */
const Listen = z.string().regex(/^[0-9.:[\]a-fA-F]+:\d{1,5}$/, 'listen must be host:port');

const ServerConfig = z.object({
  listen: Listen.default('0.0.0.0:8080'),
  trustProxy: z.boolean().default(false),
});

const OapConfig = z.object({
  /** One or more OAP admin URLs. The BFF fan-outs reads (e.g. `/list`)
   *  to every URL when building the cluster matrix; writes go to the
   *  first URL and OAP's own forward-RPC handles peer convergence. */
  adminUrls: z.array(z.string().url()).min(1),
  /** OAP query/status URL — port 12800 in upstream defaults. */
  statusUrl: z.string().url(),
});

const LocalUser = z.object({
  username: Username,
  /** argon2id hash produced by `pnpm vsadmin:hash`. */
  passwordHash: z.string().min(1),
  /** Roles assigned to this user — only consulted when `rbac.enabled`
   *  is true. Without RBAC, every authenticated user has full access. */
  roles: z.array(RoleName).default([]),
});

const LocalAuth = z.object({
  users: z.array(LocalUser).min(1),
});

const AuthConfig = z.object({
  backend: z.literal('local').default('local'),
  local: LocalAuth,
});

const RbacRole = z.object({
  verbs: z.array(Verb).min(1),
});

const RbacConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(RoleName, RbacRole).default({}),
});

const SessionConfig = z.object({
  ttlMinutes: z.number().int().positive().default(60),
  cookieName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('sid'),
  /** Set true in production (HTTPS); false for local dev / HTTP. */
  cookieSecure: z.boolean().default(true),
});

const AuditConfig = z.object({
  /** Absolute path. Daily rotation handled by external infra (logrotate /
   *  k8s log shipper). */
  file: z.string().min(1).default('/var/lib/vantage-studio/audit.jsonl'),
});

/** Wire-level debug log — captures every `/api/*` request/response
 *  and every BFF→OAP outbound call into one JSONL file with shared
 *  traceIds. Off by default; flip on for integration testing. */
const DebugLogConfig = z.object({
  enabled: z.boolean().default(false),
  /** Absolute path. Same rotation contract as `audit.file`. */
  file: z.string().min(1).default('/var/lib/vantage-studio/debug-wire.jsonl'),
  /** Per-leaf truncation, mirroring SWIP-13 §5's per-field cap. */
  maxBodyChars: z.number().int().positive().default(8192),
  /** Strip Cookie / Authorization / Set-Cookie / X-Forwarded-For
   *  before they hit the file. */
  redactAuthHeaders: z.boolean().default(true),
});

export const StudioConfigSchema = z.object({
  server: ServerConfig.default({}),
  oap: OapConfig,
  auth: AuthConfig,
  rbac: RbacConfig.optional(),
  session: SessionConfig.default({}),
  audit: AuditConfig.default({}),
  debugLog: DebugLogConfig.default({}),
});

export type StudioConfig = z.infer<typeof StudioConfigSchema>;
export type StudioLocalUser = z.infer<typeof LocalUser>;
export type StudioRbacRole = z.infer<typeof RbacRole>;
export type StudioRbacConfig = z.infer<typeof RbacConfig>;

/** Parse + validate raw YAML object. Throws zod's error (caller maps
 *  to a friendly message). */
export function parseStudioConfig(raw: unknown): StudioConfig {
  return StudioConfigSchema.parse(raw);
}
