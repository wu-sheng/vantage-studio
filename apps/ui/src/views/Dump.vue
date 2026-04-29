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
import { CATALOGS, type Catalog } from '@vantage-studio/api-client';
import { useAuthStore } from '../stores/auth.js';
import { bff } from '../api/client.js';
import Btn from '../design/primitives/Btn.vue';
import Pill from '../design/primitives/Pill.vue';

const auth = useAuthStore();

function dumpAll(): void {
  bff.triggerDump();
}
function dumpCatalog(c: Catalog): void {
  bff.triggerDump(c);
}
</script>

<template>
  <div class="dump">
    <header class="dump__header">
      <h1 class="dump__h1">Dump &amp; restore</h1>
      <Pill tone="dim">tar.gz</Pill>
    </header>

    <section class="dump__section">
      <header class="dump__sectionhead">dump</header>
      <p class="dump__hint">
        Stream a <code>tar.gz</code> snapshot of the runtime-rule rows currently in OAP.
        ACTIVE rows go under <code>&lt;catalog&gt;/&lt;name&gt;.yaml</code>, INACTIVE under
        <code>inactive/&lt;catalog&gt;/&lt;name&gt;.yaml</code>, and a top-level
        <code>manifest.yaml</code> records sha256 + status + updateTime per row.
      </p>

      <div class="dump__actions">
        <Btn
          kind="primary"
          :disabled="!auth.hasVerb('rule:read')"
          :data-testid="'dump-all'"
          @click="dumpAll"
        >
          dump all catalogs
        </Btn>
        <Btn
          v-for="c in CATALOGS"
          :key="c"
          :disabled="!auth.hasVerb('rule:read')"
          :data-testid="`dump-${c}`"
          @click="dumpCatalog(c)"
        >
          dump · {{ c }}
        </Btn>
      </div>
    </section>

    <section class="dump__section dump__section--disabled">
      <header class="dump__sectionhead">
        restore
        <Pill tone="dim">later release</Pill>
      </header>
      <p class="dump__hint">
        OAP doesn't expose a restore endpoint yet. Operators recover from a dump by
        looping <code>POST /runtime/rule/addOrUpdate</code> over each YAML file in the
        archive. A restore upload affordance will land here when the upstream API ships
        — see Studio's deferred-features memory.
      </p>
    </section>
  </div>
</template>

<style scoped>
.dump {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 900px;
}

.dump__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dump__h1 {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  font-size: 18px;
  color: var(--rr-heading);
}

.dump__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-md);
  padding: 16px 18px;
}

.dump__section--disabled {
  opacity: 0.7;
}

.dump__sectionhead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--rr-font-mono);
  font-size: 10.5px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.dump__hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--rr-ink2);
}

.dump__hint code {
  font-family: var(--rr-font-mono);
  color: var(--rr-info);
  font-size: 12px;
}

.dump__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
