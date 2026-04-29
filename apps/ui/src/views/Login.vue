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
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import Btn from '../design/primitives/Btn.vue';

const username = ref('');
const password = ref('');
const submitting = ref(false);

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

async function onSubmit(): Promise<void> {
  submitting.value = true;
  try {
    const ok = await auth.login(username.value, password.value);
    if (ok) {
      const redirect = (route.query.redirect as string | undefined) ?? '/';
      await router.push(redirect);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <div class="login__brand">
        <span class="login__logo">▰</span>
        <span class="login__title">vantage-studio</span>
      </div>
      <p class="login__subtitle">Apache SkyWalking · runtime-rule admin</p>

      <form class="login__form" @submit.prevent="onSubmit">
        <label class="login__label">
          <span>username</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            required
            data-testid="login-username"
          />
        </label>
        <label class="login__label">
          <span>password</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            data-testid="login-password"
          />
        </label>

        <p
          v-if="auth.loginError"
          class="login__error"
          data-testid="login-error"
        >
          <template v-if="auth.loginError === 'invalid_credentials'">
            invalid username or password
          </template>
          <template v-else>could not reach the server</template>
        </p>

        <Btn
          kind="primary"
          type="submit"
          :disabled="submitting"
          class="login__submit"
        >
          {{ submitting ? 'signing in…' : 'sign in' }}
        </Btn>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--rr-bg);
}

.login__card {
  width: 360px;
  padding: 32px 28px;
  background: var(--rr-bg2);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-lg);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.login__logo {
  color: var(--rr-active);
  font-size: 18px;
}

.login__title {
  font-family: var(--rr-font-mono);
  font-size: 16px;
  font-weight: 500;
  color: var(--rr-heading);
}

.login__subtitle {
  margin: 0 0 24px;
  font-size: 11.5px;
  color: var(--rr-dim);
  font-family: var(--rr-font-mono);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  letter-spacing: 0.4px;
}

.login__label input {
  background: var(--rr-bg);
}

.login__error {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-err);
}

.login__submit {
  margin-top: 4px;
  justify-content: center;
}
</style>
