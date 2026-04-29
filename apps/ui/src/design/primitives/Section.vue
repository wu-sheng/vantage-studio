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
defineProps<{
  title: string;
  kicker?: string;
}>();
</script>

<template>
  <section class="section">
    <header class="section__header">
      <span v-if="kicker" class="section__kicker">{{ kicker }}</span>
      <span class="section__title">{{ title }}</span>
      <div class="section__actions"><slot name="actions" /></div>
    </header>
    <div class="section__body"><slot /></div>
  </section>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-md);
}

.section__header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 34px;
  padding: 0 14px;
  background: var(--rr-bg2);
  border-bottom: 1px solid var(--rr-border);
  flex-shrink: 0;
}

.section__kicker {
  font-family: var(--rr-font-mono);
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--rr-dim);
}

.section__title {
  font-family: var(--rr-font-ui);
  font-size: 13px;
  font-weight: 500;
  color: var(--rr-heading);
}

.section__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section__body {
  padding: 14px;
}
</style>
