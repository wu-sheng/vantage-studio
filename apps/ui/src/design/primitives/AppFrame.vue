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
import { useAuthStore } from '../../stores/auth.js';
import { useRouter } from 'vue-router';
import CatalogNav from './CatalogNav.vue';
import Btn from './Btn.vue';

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="appframe">
    <header class="appframe__header">
      <div class="appframe__brand">
        <span class="appframe__logo">▰</span>
        <span class="appframe__title">vantage-studio</span>
      </div>
      <div class="appframe__spacer" />
      <div v-if="auth.user" class="appframe__user">
        <span class="appframe__userlabel">{{ auth.user.username }}</span>
        <Btn kind="ghost" size="sm" @click="logout">logout</Btn>
      </div>
    </header>
    <div class="appframe__body">
      <aside class="appframe__nav">
        <CatalogNav />
      </aside>
      <main class="appframe__main">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.appframe {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--rr-bg);
  color: var(--rr-ink);
}

.appframe__header {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 14px;
  background: var(--rr-bg2);
  border-bottom: 1px solid var(--rr-border);
  gap: 14px;
  flex-shrink: 0;
}

.appframe__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.appframe__logo {
  color: var(--rr-active);
  font-family: var(--rr-font-mono);
  font-size: 14px;
}

.appframe__title {
  font-family: var(--rr-font-mono);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--rr-heading);
}

.appframe__spacer {
  flex: 1 1 auto;
}

.appframe__user {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-ink2);
}

.appframe__userlabel {
  letter-spacing: 0.3px;
}

.appframe__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.appframe__nav {
  width: 220px;
  background: var(--rr-bg);
  border-right: 1px solid var(--rr-border);
  flex-shrink: 0;
  overflow: auto;
}

.appframe__main {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  background: var(--rr-bg);
}
</style>
