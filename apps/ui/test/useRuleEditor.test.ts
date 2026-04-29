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

import { ref, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { ApplyResult, Catalog, RuleResponse } from '@vantage-studio/api-client';
import { useRuleEditor } from '../src/composables/useRuleEditor.js';
import type { BffApiError } from '../src/api/client.js';

interface ClientStub {
  getRule: ReturnType<typeof vi.fn>;
  saveRule: ReturnType<typeof vi.fn>;
  inactivateRule: ReturnType<typeof vi.fn>;
  deleteRule: ReturnType<typeof vi.fn>;
  catalogList: ReturnType<typeof vi.fn>;
  catalogBundled: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  me: ReturnType<typeof vi.fn>;
}

function makeClient(overrides: Partial<ClientStub> = {}): ClientStub {
  return {
    getRule: vi.fn(),
    saveRule: vi.fn(),
    inactivateRule: vi.fn(),
    deleteRule: vi.fn(),
    catalogList: vi.fn(),
    catalogBundled: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    ...overrides,
  };
}

const sampleRule: RuleResponse = {
  status: 'ACTIVE',
  source: 'runtime',
  contentHash: 'aaa',
  updateTime: 1730000000000,
  etag: '"aaa"',
  content: 'metricsRules:\n  - name: vm_cpu',
};

function makeRefs(catalog: Catalog | null = 'otel-rules', name: string | null = 'vm') {
  return { catalog: ref(catalog), name: ref(name) };
}

describe('useRuleEditor', () => {
  it('loads on mount and resets buffer to the server content', async () => {
    const client = makeClient({
      getRule: vi.fn().mockResolvedValue(sampleRule),
    });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.original.value).toEqual(sampleRule);
    expect(editor.buffer.value).toBe(sampleRule.content);
    expect(editor.dirty.value).toBe(false);
    expect(client.getRule).toHaveBeenCalledWith({ catalog: 'otel-rules', name: 'vm' });
  });

  it('marks dirty when the buffer diverges from the server content', async () => {
    const client = makeClient({ getRule: vi.fn().mockResolvedValue(sampleRule) });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await nextTick();
    await Promise.resolve();
    editor.buffer.value = 'different';
    expect(editor.dirty.value).toBe(true);
  });

  it('save returns ok on 200 + applyStatus', async () => {
    const result: ApplyResult = {
      applyStatus: 'filter_only_applied',
      catalog: 'otel-rules',
      name: 'vm',
      message: '',
    };
    const client = makeClient({
      getRule: vi.fn().mockResolvedValue(sampleRule),
      saveRule: vi.fn().mockResolvedValue(result),
    });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    await Promise.resolve();
    editor.buffer.value = 'changed';
    const r = await editor.save();
    expect(r.kind).toBe('ok');
    expect(client.saveRule).toHaveBeenCalledWith({
      catalog: 'otel-rules',
      name: 'vm',
      body: 'changed',
    });
  });

  it('save returns needs-storage-change on 409', async () => {
    const errBody: ApplyResult = {
      applyStatus: 'storage_change_requires_explicit_approval',
      catalog: 'otel-rules',
      name: 'vm',
      message: 'set allowStorageChange=true',
    };
    const apiErr: BffApiError = { status: 409, body: errBody };
    const client = makeClient({
      getRule: vi.fn().mockResolvedValue(sampleRule),
      saveRule: vi.fn().mockRejectedValue(apiErr),
    });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    await Promise.resolve();
    editor.buffer.value = 'changed';
    const r = await editor.save();
    expect(r.kind).toBe('needs-storage-change');
  });

  it('deleteRule returns needs-inactivate-first on 409', async () => {
    const errBody: ApplyResult = {
      applyStatus: 'requires_inactivate_first',
      catalog: 'otel-rules',
      name: 'vm',
      message: '',
    };
    const apiErr: BffApiError = { status: 409, body: errBody };
    const client = makeClient({
      getRule: vi.fn().mockResolvedValue(sampleRule),
      deleteRule: vi.fn().mockRejectedValue(apiErr),
    });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    await Promise.resolve();
    const r = await editor.deleteRule('');
    expect(r.kind).toBe('needs-inactivate-first');
  });

  it('deleteRule(revertToBundled) returns no-bundled-twin on 400', async () => {
    const errBody: ApplyResult = {
      applyStatus: 'no_bundled_twin',
      catalog: 'lal',
      name: 'envoy-als',
      message: 'no bundled version on disk',
    };
    const apiErr: BffApiError = { status: 400, body: errBody };
    const client = makeClient({
      getRule: vi.fn().mockResolvedValue(sampleRule),
      deleteRule: vi.fn().mockRejectedValue(apiErr),
    });
    const refs = makeRefs('lal', 'envoy-als');
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    await Promise.resolve();
    const r = await editor.deleteRule('revertToBundled');
    expect(r.kind).toBe('no-bundled-twin');
    expect(client.deleteRule).toHaveBeenCalledWith('lal', 'envoy-als', 'revertToBundled');
  });

  it('fetchBundled returns null on 404', async () => {
    const apiErr: BffApiError = { status: 404, body: {} };
    const client = makeClient({
      getRule: vi
        .fn()
        .mockResolvedValueOnce(sampleRule) // initial load
        .mockRejectedValueOnce(apiErr), // fetchBundled call
    });
    const refs = makeRefs();
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    await Promise.resolve();
    const got = await editor.fetchBundled();
    expect(got).toBeNull();
  });

  it('does nothing when catalog or name is null', async () => {
    const client = makeClient({ getRule: vi.fn() });
    const refs = makeRefs(null, null);
    const editor = useRuleEditor({
      ...refs,
      client: client as unknown as typeof import('../src/api/client.js').bff,
    });
    await Promise.resolve();
    expect(client.getRule).not.toHaveBeenCalled();
    expect(editor.original.value).toBeNull();
  });
});
