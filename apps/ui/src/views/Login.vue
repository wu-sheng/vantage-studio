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
import { useAuthStore } from '../stores/auth.js';
import Btn from '../design/primitives/Btn.vue';

const username = ref('');
const password = ref('');
const submitting = ref(false);

const auth = useAuthStore();

async function onSubmit(): Promise<void> {
  submitting.value = true;
  try {
    const ok = await auth.login(username.value, password.value);
    if (ok) {
      // Always land on /cluster after a successful login. The
      // session-expired redirect chain previously honoured
      // `?redirect=<X>`, but operators consistently want the cluster
      // dashboard first regardless of where the prior session got
      // bumped — predictable wins. `window.location` rather than
      // `router.push` so the route state is fully reset (no stale
      // query lingering, no vue-query cache from the prior session).
      window.location.assign('/cluster');
      return;
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <header class="login__brand">
        <img class="login__logo" src="/vs-logo-mark.png" alt="" decoding="async" />
        <h1 class="login__title">VANTAGE STUDIO</h1>
        <p class="login__subtitle">Admin UI &amp; telemetry script analysis</p>
        <p class="login__sub2">Apache SkyWalking · runtime-rule admin</p>
      </header>

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
  background:
    /* Subtle radial highlight behind the card so the brand mark sits
       on a faint glow rather than a flat field — matches the
       mission-control aesthetic without overwhelming the page. */
    radial-gradient(
      ellipse 800px 500px at 50% 40%,
      color-mix(in oklab, var(--rr-accent) 8%, transparent) 0%,
      transparent 70%
    ),
    var(--rr-bg);
}

.login__card {
  width: 440px;
  padding: 40px 36px 36px;
  /* Card background = logo's baked-in #1c2630 (var --rr-bg3) so the
     PNG dissolves into the card with no visible rectangle. */
  background: var(--rr-bg3);
  border: 1px solid var(--rr-border);
  border-radius: var(--rr-radius-lg);
  box-shadow:
    0 24px 60px -20px rgba(0, 0, 0, 0.6),
    0 0 0 1px color-mix(in oklab, var(--rr-accent) 10%, transparent);
}

.login__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-bottom: 32px;
  text-align: center;
}

.login__logo {
  display: block;
  height: 96px;
  width: auto;
}

.login__title {
  font-family: var(--rr-font-mono);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--rr-heading);
  margin: 0;
}

.login__subtitle {
  margin: 0;
  font-family: var(--rr-font-ui);
  font-size: 15px;
  font-weight: 500;
  color: var(--rr-ink2);
  letter-spacing: 0.5px;
}

.login__sub2 {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 13px;
  color: var(--rr-dim);
  letter-spacing: 0.6px;
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.login__label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-family: var(--rr-font-mono);
  color: var(--rr-ink2);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.login__label input {
  background: var(--rr-bg);
  font-family: var(--rr-font-mono);
  font-size: 16px;
  letter-spacing: 0.4px;
  padding: 10px 12px;
  text-transform: none;
}

.login__error {
  margin: 0;
  font-family: var(--rr-font-mono);
  font-size: 14px;
  color: var(--rr-err);
}

.login__submit {
  margin-top: 8px;
  justify-content: center;
  font-size: 15px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 10px 16px;
}
</style>
