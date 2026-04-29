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
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Section from '../design/primitives/Section.vue';
import Btn from '../design/primitives/Btn.vue';
import Pill from '../design/primitives/Pill.vue';

const route = useRoute();
const router = useRouter();

const catalog = computed(() => (route.query.catalog as string | undefined) ?? '');
const name = computed(() => (route.query.name as string | undefined) ?? '');
</script>

<template>
  <div class="editor">
    <header class="editor__header">
      <h1 class="editor__h1">
        Edit · <span class="editor__catalog">{{ catalog }}</span>
        <span class="editor__sep">/</span>
        <span class="editor__name">{{ name }}</span>
      </h1>
      <Pill tone="info">phase 6</Pill>
      <div class="editor__spacer" />
      <Btn @click="router.back()">← back to catalog</Btn>
    </header>

    <Section title="Editor" kicker="form-assisted yaml">
      <p class="editor__placeholder">
        Phase 6 wires this view to <code>GET /api/rule</code> +
        <code>POST /api/rule</code> with Monaco for the YAML body, the
        bundled MAL/LAL DSL grammar snapshot for autocomplete, and the
        Save / Inactivate / Delete / Delete-revertToBundled action set.
        The destructive-confirm gate (typed-name) lives behind the
        <code>allowStorageChange</code> path.
      </p>
    </Section>
  </div>
</template>

<style scoped>
.editor {
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1400px;
}

.editor__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.editor__h1 {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  font-size: 18px;
  color: var(--rr-heading);
}

.editor__catalog,
.editor__name {
  font-family: var(--rr-font-mono);
  color: var(--rr-active);
}

.editor__sep {
  margin: 0 4px;
  color: var(--rr-dim);
}

.editor__spacer {
  flex: 1 1 auto;
}

.editor__placeholder {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--rr-ink2);
}

.editor__placeholder code {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  color: var(--rr-info);
}
</style>
