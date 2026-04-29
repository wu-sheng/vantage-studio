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

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/Login.vue'),
    meta: { layout: 'auth', requiresAuth: false },
  },
  {
    path: '/',
    redirect: '/catalog/otel-rules',
  },
  {
    path: '/catalog/:catalog',
    name: 'catalog',
    component: () => import('./views/Catalog.vue'),
    meta: { layout: 'main', requiresAuth: true },
    props: true,
  },
  {
    path: '/edit',
    name: 'edit',
    component: () => import('./views/Editor.vue'),
    meta: { layout: 'main', requiresAuth: true },
  },
  {
    path: '/cluster',
    name: 'cluster',
    component: () => import('./views/ClusterStatus.vue'),
    meta: { layout: 'main', requiresAuth: true },
  },
  {
    path: '/dump',
    name: 'dump',
    component: () => import('./views/Dump.vue'),
    meta: { layout: 'main', requiresAuth: true },
  },
  {
    path: '/dsl',
    name: 'dsl',
    component: () => import('./views/DslManagement.vue'),
    meta: { layout: 'main', requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./views/NotFound.vue'),
    meta: { layout: 'main', requiresAuth: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // The first nav after page-load happens before `App.vue` had a chance
  // to await the bootstrap. Block here once so guards see the real
  // auth state.
  if (auth.bootstrapping) {
    await auth.bootstrap();
  }
  const requiresAuth = to.meta.requiresAuth !== false;
  if (requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { path: '/' };
  }
  return true;
});
