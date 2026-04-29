<!--
  Copyright 2026 The Vantage Studio Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->
<script setup lang="ts">
import { useAuthStore } from '../stores/auth.js';
import Pill from '../design/primitives/Pill.vue';

const auth = useAuthStore();

interface VerbRow {
  verb: string;
  surface: string;
  notes: string;
}

const verbs: VerbRow[] = [
  { verb: 'rule:read', surface: 'catalog browse, /rule GET, dump', notes: 'always granted to authenticated users' },
  { verb: 'rule:write', surface: 'addOrUpdate (filter-only), inactivate', notes: '—' },
  {
    verb: 'rule:write:structural',
    surface: 'addOrUpdate (allowStorageChange or force=true), revert-to-bundled',
    notes: 'gates every schema-change destructive path',
  },
  { verb: 'rule:delete', surface: '/rule/delete', notes: 'default delete is non-destructive' },
  { verb: 'cluster:read', surface: '/cluster/state matrix', notes: '—' },
  { verb: 'admin', surface: 'audit read', notes: '—' },
];

function holds(v: string): boolean {
  return auth.hasVerb(v);
}
</script>

<template>
  <div class="dsl">
    <header class="dsl__header">
      <h1 class="dsl__h1">DSL Management</h1>
    </header>

    <section class="dsl__section">
      <header class="dsl__sectionhead">where destructive operations live</header>
      <p class="dsl__hint">
        Every schema-change action lives inside the rule editor as a typed-name confirm:
      </p>
      <ul class="dsl__list">
        <li>
          <strong>Save with <code>allowStorageChange</code></strong> — auto-triggers when
          OAP rejects a save with <code>storage_change_requires_explicit_approval</code>.
        </li>
        <li>
          <strong>Revert to bundled</strong> — explicit button on the editor for any rule
          that has a bundled twin on disk. Runs the standard apply pipeline against the
          bundled YAML; runtime-only metrics are dropped.
        </li>
        <li>
          <strong>Recovery (<code>force=true</code>)</strong> — re-runs apply on
          byte-identical content, under the editor's "advanced" disclosure. Subsumes the
          old <code>/fix</code> route.
        </li>
      </ul>
      <p class="dsl__hint">
        Default <code>delete</code> is non-destructive — the runtime row is removed and
        any backend resource is left as an inert artefact.
      </p>
    </section>

    <section class="dsl__section">
      <header class="dsl__sectionhead">your access</header>
      <p v-if="!auth.user" class="dsl__hint">not signed in</p>
      <table v-else class="dsl__table">
        <thead>
          <tr>
            <th>verb</th>
            <th>surface</th>
            <th>granted</th>
            <th>notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in verbs" :key="row.verb">
            <td><code>{{ row.verb }}</code></td>
            <td>{{ row.surface }}</td>
            <td>
              <Pill :tone="holds(row.verb) ? 'ok' : 'dim'">
                {{ holds(row.verb) ? 'yes' : 'no' }}
              </Pill>
            </td>
            <td class="dsl__notes">{{ row.notes }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="auth.user && auth.user.verbs.includes('*')" class="dsl__hint">
        RBAC is disabled in studio.yaml — every authenticated user holds every verb.
      </p>
    </section>
  </div>
</template>

<style scoped>
.dsl {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1100px;
}

.dsl__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dsl__h1 {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  font-size: 18px;
  color: var(--rr-heading);
}

.dsl__section {
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-md);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dsl__sectionhead {
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.dsl__hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--rr-ink2);
}

.dsl__hint code,
.dsl__list code,
.dsl__table code {
  font-family: var(--rr-font-mono);
  color: var(--rr-info);
  font-size: 12px;
}

.dsl__list {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--rr-ink);
}

.dsl__list li {
  margin-bottom: 6px;
}

.dsl__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dsl__table th,
.dsl__table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--rr-border);
}

.dsl__table th {
  font-family: var(--rr-font-mono);
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.dsl__notes {
  color: var(--rr-dim);
}
</style>
