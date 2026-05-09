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
import { decodeEntityId } from '../src/views/debug/oalEntityId.js';

/** Mirror the IDManager builders so the fixtures stay close to OAP's
 *  actual encoding rules — easier to spot drift than hand-rolled
 *  expected strings. */
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}
const svc = (name: string, layer: number) => `${b64(name)}.${layer}`;
const instance = (sId: string, n: string) => `${sId}_${b64(n)}`;
const endpoint = (sId: string, n: string) => `${sId}_${b64(n)}`;

describe('decodeEntityId', () => {
  it('Service: name + layer', () => {
    expect(decodeEntityId('Service', svc('checkout', 2))).toBe('checkout · GENERAL');
    expect(decodeEntityId('Service', svc('e2e-service-consumer', 1))).toBe(
      'e2e-service-consumer · MESH',
    );
    expect(decodeEntityId('Service', svc('frontend', 23))).toBe('frontend · OS_WINDOWS');
  });

  it('Service: unknown layer ordinal falls back to layer-N', () => {
    expect(decodeEntityId('Service', svc('thing', 999))).toBe('thing · layer-999');
  });

  it('ServiceInstance: service → instance · layer', () => {
    const id = instance(svc('checkout', 2), 'pod-a7');
    expect(decodeEntityId('ServiceInstance', id)).toBe('checkout → pod-a7 · GENERAL');
  });

  it('Endpoint: service → endpoint · layer', () => {
    const id = endpoint(svc('checkout', 2), '/api/orders');
    expect(decodeEntityId('Endpoint', id)).toBe('checkout → /api/orders · GENERAL');
  });

  it('ServiceRelation: src (layer) → dst (layer)', () => {
    const id = `${svc('checkout', 2)}-${svc('catalog', 2)}`;
    expect(decodeEntityId('ServiceRelation', id)).toBe('checkout (GENERAL) → catalog (GENERAL)');
  });

  it('ServiceInstanceRelation: split on first `-`', () => {
    const src = instance(svc('checkout', 2), 'pod-a7');
    const dst = instance(svc('catalog', 2), 'pod-b3');
    expect(decodeEntityId('ServiceInstanceRelation', `${src}-${dst}`)).toBe(
      'checkout/pod-a7 → catalog/pod-b3',
    );
  });

  it('EndpointRelation: 4 dash-joined segments', () => {
    const id = [
      svc('checkout', 2),
      b64('/api/orders'),
      svc('catalog', 2),
      b64('/api/items/127'),
    ].join('-');
    expect(decodeEntityId('EndpointRelation', id)).toBe(
      'checkout//api/orders → catalog//api/items/127',
    );
  });

  it('returns null on missing input or unknown scope', () => {
    expect(decodeEntityId('', svc('x', 2))).toBeNull();
    expect(decodeEntityId('Service', '')).toBeNull();
    expect(decodeEntityId(undefined, svc('x', 2))).toBeNull();
    expect(decodeEntityId('UnknownScope', svc('x', 2))).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(decodeEntityId('Service', 'not-base64.2')).toBeNull(); // technically `not-base64` parses as base64 of garbage; verify the layer parse
    expect(decodeEntityId('Service', 'no-layer-suffix')).toBeNull();
    expect(decodeEntityId('Endpoint', 'missing_underscore')).toBeNull();
    expect(decodeEntityId('EndpointRelation', 'only-three-parts-here')).toBeNull();
  });

  it('round-trips multi-byte names through UTF-8', () => {
    const id = svc('日本語サービス', 2);
    expect(decodeEntityId('Service', id)).toBe('日本語サービス · GENERAL');
  });
});
