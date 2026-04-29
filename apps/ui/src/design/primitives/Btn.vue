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
type Kind = 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

withDefaults(
  defineProps<{
    kind?: Kind;
    size?: Size;
    type?: 'button' | 'submit';
    disabled?: boolean;
  }>(),
  { kind: 'ghost', size: 'md', type: 'button', disabled: false },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="btn"
    :class="[`btn--${kind}`, `btn--${size}`]"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--rr-font-ui);
  font-weight: 500;
  letter-spacing: 0.2px;
  border: 1px solid transparent;
  border-radius: var(--rr-radius-md);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.08s ease;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn--md {
  padding: 5px 12px;
  font-size: 12px;
}

.btn--sm {
  padding: 3px 8px;
  font-size: 11px;
}

.btn--ghost {
  background: transparent;
  color: var(--rr-ink);
  border-color: var(--rr-border2);
}
.btn--ghost:hover:not(:disabled) {
  background: var(--rr-bg2);
  border-color: var(--rr-active);
  color: var(--rr-heading);
}

.btn--primary {
  background: var(--rr-active);
  color: var(--rr-bg);
  border-color: var(--rr-active);
}
.btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.btn--danger {
  background: transparent;
  color: var(--rr-err);
  border-color: var(--rr-err);
}
.btn--danger:hover:not(:disabled) {
  background: color-mix(in oklch, var(--rr-err) 15%, transparent);
}
</style>
