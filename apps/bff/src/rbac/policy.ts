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
 * RBAC policy resolver.
 *
 * RBAC is **optional** — if the `rbac` block is absent or
 * `rbac.enabled: false`, every authenticated user implicitly has the
 * `*` wildcard verb (full access). The middleware (auth/middleware.ts)
 * still calls these helpers; they just always permit.
 */

import type { StudioConfig } from '../config/schema.js';

/** Resolve the verb set granted to a session's roles under the given
 *  config. Returns `['*']` when RBAC is disabled. */
export function resolveVerbs(config: StudioConfig, roles: readonly string[]): string[] {
  if (!isRbacEnabled(config)) return ['*'];

  const allRoles = config.rbac?.roles ?? {};
  const set = new Set<string>();
  for (const roleName of roles) {
    const role = allRoles[roleName];
    if (!role) continue;
    for (const v of role.verbs) set.add(v);
  }
  return [...set];
}

/** True iff the resolved verb set permits the given verb. */
export function hasVerb(grantedVerbs: readonly string[], required: string): boolean {
  if (grantedVerbs.includes('*')) return true;
  return grantedVerbs.includes(required);
}

export function isRbacEnabled(config: StudioConfig): boolean {
  return Boolean(config.rbac?.enabled);
}

/** Convenience — check a session's roles against a single verb. */
export function sessionHasVerb(
  config: StudioConfig,
  roles: readonly string[],
  required: string,
): boolean {
  return hasVerb(resolveVerbs(config, roles), required);
}
