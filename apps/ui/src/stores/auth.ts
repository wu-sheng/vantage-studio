/*
 * Copyright 2026 The Vantage Studio Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { defineStore } from 'pinia';
import { bff, type BffMe } from '../api/client.js';

interface AuthState {
  /** `null` when not yet bootstrapped or after logout. */
  user: BffMe | null;
  /** True while the very first `/api/auth/me` is in flight. */
  bootstrapping: boolean;
  loginError: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    bootstrapping: true,
    loginError: null,
  }),

  getters: {
    isAuthenticated: (s): boolean => s.user !== null,
    /** True iff the current user has the given verb (or `*`). When
     *  RBAC is disabled server-side, the BFF returns `verbs: ['*']`. */
    hasVerb:
      (s) =>
      (verb: string): boolean => {
        if (!s.user) return false;
        return s.user.verbs.includes('*') || s.user.verbs.includes(verb);
      },
  },

  actions: {
    /** Called once at app mount. Sets `user` from the BFF or leaves it
     *  null if the cookie is gone / never existed. Always clears
     *  `bootstrapping`. */
    async bootstrap(): Promise<void> {
      try {
        this.user = await bff.me();
      } finally {
        this.bootstrapping = false;
      }
    },

    async login(username: string, password: string): Promise<boolean> {
      this.loginError = null;
      try {
        this.user = await bff.login(username, password);
        return true;
      } catch (err) {
        this.loginError =
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          (err as { status: number }).status === 401
            ? 'invalid_credentials'
            : 'login_failed';
        return false;
      }
    },

    async logout(): Promise<void> {
      try {
        await bff.logout();
      } finally {
        this.user = null;
      }
    },
  },
});
