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
type Tone = 'ok' | 'warn' | 'err' | 'info' | 'dim';

withDefaults(
  defineProps<{
    tone?: Tone;
    size?: number;
  }>(),
  { tone: 'dim', size: 8 },
);
</script>

<template>
  <span
    class="dot"
    :class="`dot--${tone}`"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.dot {
  display: inline-block;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--rr-dim);
}

.dot--ok {
  background: var(--rr-ok);
}
.dot--warn {
  background: var(--rr-warn);
}
.dot--err {
  background: var(--rr-err);
}
.dot--info {
  background: var(--rr-info);
}
</style>
