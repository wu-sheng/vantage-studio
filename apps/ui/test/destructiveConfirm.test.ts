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

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DestructiveConfirm from '../src/views/components/DestructiveConfirm.vue';

function mountConfirm(ruleName = 'vm') {
  return mount(DestructiveConfirm, {
    props: {
      open: true,
      title: 'Storage change',
      intent: 'push a STRUCTURAL change to',
      ruleName,
      warning: ['this drops data on BanyanDB.'],
    },
    attachTo: document.body,
  });
}

describe('DestructiveConfirm.vue', () => {
  it('disables confirm until the rule name is typed exactly', async () => {
    const wrapper = mountConfirm('vm');
    const confirmBtn = document.body.querySelector(
      '[data-testid="destructive-confirm"]',
    ) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    const input = document.body.querySelector(
      '[data-testid="destructive-input"]',
    ) as HTMLInputElement;
    input.value = 'no';
    input.dispatchEvent(new Event('input'));
    await wrapper.vm.$nextTick();
    expect(confirmBtn.disabled).toBe(true);

    input.value = 'vm';
    input.dispatchEvent(new Event('input'));
    await wrapper.vm.$nextTick();
    expect(confirmBtn.disabled).toBe(false);

    wrapper.unmount();
  });

  it('emits confirm when the armed button is clicked', async () => {
    const wrapper = mountConfirm('vm');
    const input = document.body.querySelector(
      '[data-testid="destructive-input"]',
    ) as HTMLInputElement;
    input.value = 'vm';
    input.dispatchEvent(new Event('input'));
    await wrapper.vm.$nextTick();

    const confirmBtn = document.body.querySelector(
      '[data-testid="destructive-confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('confirm')).toHaveLength(1);
    wrapper.unmount();
  });

  it('renders every warning line', () => {
    const wrapper = mount(DestructiveConfirm, {
      props: {
        open: true,
        title: 't',
        intent: 'do thing',
        ruleName: 'r',
        warning: ['line one.', 'line two.'],
      },
      attachTo: document.body,
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('line one.');
    expect(text).toContain('line two.');
    wrapper.unmount();
  });
});
