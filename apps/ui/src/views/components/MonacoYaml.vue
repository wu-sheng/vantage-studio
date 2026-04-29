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
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as monaco from 'monaco-editor';
import type { Catalog } from '@vantage-studio/api-client';
import { setupMonaco, setModelCatalog, RR_THEME_NAME } from '../../monaco/setup.js';

const props = defineProps<{
  modelValue: string;
  catalog: Catalog | null;
  readOnly?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const host = ref<HTMLDivElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
let suppressChange = false;

onMounted(() => {
  if (!host.value) return;
  setupMonaco();

  model = monaco.editor.createModel(props.modelValue, 'yaml');
  if (props.catalog) setModelCatalog(model, props.catalog);

  editor = monaco.editor.create(host.value, {
    model,
    theme: RR_THEME_NAME,
    automaticLayout: true,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    readOnly: props.readOnly ?? false,
    renderWhitespace: 'selection',
    smoothScrolling: true,
    wordWrap: 'off',
  });

  model.onDidChangeContent(() => {
    if (suppressChange) return;
    if (model) emit('update:modelValue', model.getValue());
  });
});

watch(
  () => props.modelValue,
  (next) => {
    if (model && model.getValue() !== next) {
      suppressChange = true;
      try {
        model.setValue(next);
      } finally {
        suppressChange = false;
      }
    }
  },
);

watch(
  () => props.catalog,
  (next) => {
    if (model && next) setModelCatalog(model, next);
  },
);

watch(
  () => props.readOnly,
  (ro) => {
    if (editor) editor.updateOptions({ readOnly: ro ?? false });
  },
);

onBeforeUnmount(() => {
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
});
</script>

<template>
  <div ref="host" class="monaco" :data-testid="'monaco-yaml'" />
</template>

<style scoped>
.monaco {
  width: 100%;
  height: 100%;
  min-height: 320px;
}
</style>
