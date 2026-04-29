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
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import Btn from '../../design/primitives/Btn.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  /** Verb the operator is about to take ("save with allowStorageChange",
   *  "revert to bundled", …). Shown verbatim. */
  intent: string;
  /** Rule name the user must type to confirm. */
  ruleName: string;
  /** Optional warning paragraphs. Each rendered as a `<p>`. */
  warning: readonly string[];
  /** Loading flag — disables the button while the action is in flight. */
  busy?: boolean;
}>();

const emit = defineEmits<{ confirm: []; close: [] }>();

const typed = ref('');

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) typed.value = '';
  },
);

const armed = computed<boolean>(() => typed.value === props.ruleName);
</script>

<template>
  <Modal :open="open" :title="title" @close="emit('close')">
    <p class="dc__intent">
      You are about to <strong>{{ intent }}</strong> <code>{{ ruleName }}</code>.
    </p>
    <ul class="dc__warning">
      <li v-for="(line, i) in warning" :key="i">{{ line }}</li>
    </ul>
    <label class="dc__label">
      Type <code>{{ ruleName }}</code> to confirm:
      <input
        v-model="typed"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :data-testid="'destructive-input'"
      />
    </label>

    <template #footer>
      <Btn @click="emit('close')">cancel</Btn>
      <Btn
        kind="danger"
        :disabled="!armed || busy"
        :data-testid="'destructive-confirm'"
        @click="emit('confirm')"
      >
        {{ busy ? 'applying…' : 'confirm' }}
      </Btn>
    </template>
  </Modal>
</template>

<style scoped>
.dc__intent {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--rr-ink);
}

.dc__intent code,
.dc__label code {
  font-family: var(--rr-font-mono);
  color: var(--rr-active);
  font-size: 12px;
}

.dc__warning {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--rr-warn);
}

.dc__warning li {
  margin-bottom: 4px;
}

.dc__label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--rr-ink2);
  font-family: var(--rr-font-mono);
}

.dc__label input {
  font-family: var(--rr-font-mono);
}
</style>
