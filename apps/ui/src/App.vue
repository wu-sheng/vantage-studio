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
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import AppFrame from './design/primitives/AppFrame.vue';

const route = useRoute();
const auth = useAuthStore();

const layout = computed<'auth' | 'main'>(() =>
  route.meta.layout === 'auth' ? 'auth' : 'main',
);

onMounted(async () => {
  // Ensure auth is bootstrapped even if the user lands on /login
  // directly (the router guard runs before mount on the first nav).
  if (auth.bootstrapping) await auth.bootstrap();
});
</script>

<template>
  <AppFrame v-if="layout === 'main'">
    <router-view />
  </AppFrame>
  <router-view v-else />
</template>
