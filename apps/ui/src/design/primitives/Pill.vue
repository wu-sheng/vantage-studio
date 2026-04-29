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
type Tone = 'ok' | 'warn' | 'err' | 'info' | 'dim' | 'active';

withDefaults(
  defineProps<{
    tone?: Tone;
  }>(),
  { tone: 'dim' },
);
</script>

<template>
  <span class="pill" :class="`pill--${tone}`"><slot /></span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  font-family: var(--rr-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--rr-border2);
  background: var(--rr-bg2);
  color: var(--rr-ink2);
}

.pill--ok {
  border-color: color-mix(in oklch, var(--rr-ok) 50%, var(--rr-border2));
  color: var(--rr-ok);
}
.pill--warn {
  border-color: color-mix(in oklch, var(--rr-warn) 50%, var(--rr-border2));
  color: var(--rr-warn);
}
.pill--err {
  border-color: color-mix(in oklch, var(--rr-err) 50%, var(--rr-border2));
  color: var(--rr-err);
}
.pill--info {
  border-color: color-mix(in oklch, var(--rr-info) 50%, var(--rr-border2));
  color: var(--rr-info);
}
.pill--active {
  border-color: var(--rr-active);
  color: var(--rr-active);
}
</style>
