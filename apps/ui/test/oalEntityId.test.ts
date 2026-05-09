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
import { decodeEntityId, decodeMetricId } from '../src/views/debug/oalEntityId.js';

/** Mirror IDManager so the fixtures stay close to OAP's actual
 *  encoding rules — easier to spot drift than hand-rolled expected
 *  strings. */
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}
const svc = (name: string, normal: 0 | 1) => `${b64(name)}.${normal}`;
const instance = (sId: string, n: string) => `${sId}_${b64(n)}`;
const endpoint = (sId: string, n: string) => `${sId}_${b64(n)}`;

describe('decodeEntityId', () => {
  it('Service: name + real (isNormal=1)', () => {
    expect(decodeEntityId('Service', svc('e2e-service-provider', 1))).toBe(
      'e2e-service-provider · real',
    );
    expect(decodeEntityId('Service', svc('checkout', 1))).toBe('checkout · real');
  });

  it('Service: name + virtual (isNormal=0)', () => {
    expect(decodeEntityId('Service', svc('virtual-mq-peer', 0))).toBe('virtual-mq-peer · virtual');
  });

  it('Service: only `0` and `1` are valid suffixes', () => {
    expect(decodeEntityId('Service', `${b64('thing')}.2`)).toBeNull();
    expect(decodeEntityId('Service', `${b64('thing')}.99`)).toBeNull();
    expect(decodeEntityId('Service', `${b64('thing')}.foo`)).toBeNull();
  });

  it('ServiceInstance: service → instance · real|virtual', () => {
    const real = instance(svc('checkout', 1), 'pod-a7');
    expect(decodeEntityId('ServiceInstance', real)).toBe('checkout → pod-a7 · real');
    const virt = instance(svc('virtual-db', 0), 'shard-0');
    expect(decodeEntityId('ServiceInstance', virt)).toBe('virtual-db → shard-0 · virtual');
  });

  it('Endpoint: service → endpoint · real|virtual', () => {
    const id = endpoint(svc('checkout', 1), '/api/orders');
    expect(decodeEntityId('Endpoint', id)).toBe('checkout → /api/orders · real');
  });

  it('ServiceRelation: src (real|virtual) → dst (real|virtual)', () => {
    const id = `${svc('checkout', 1)}-${svc('virtual-mq', 0)}`;
    expect(decodeEntityId('ServiceRelation', id)).toBe('checkout (real) → virtual-mq (virtual)');
  });

  it('ServiceInstanceRelation: split on first `-`', () => {
    const src = instance(svc('checkout', 1), 'pod-a7');
    const dst = instance(svc('catalog', 1), 'pod-b3');
    expect(decodeEntityId('ServiceInstanceRelation', `${src}-${dst}`)).toBe(
      'checkout/pod-a7 → catalog/pod-b3',
    );
  });

  it('EndpointRelation: 4 dash-joined segments', () => {
    const id = [
      svc('checkout', 1),
      b64('/api/orders'),
      svc('catalog', 1),
      b64('/api/items/127'),
    ].join('-');
    expect(decodeEntityId('EndpointRelation', id)).toBe(
      'checkout//api/orders → catalog//api/items/127',
    );
  });

  it('returns null on missing input or unknown scope', () => {
    expect(decodeEntityId('', svc('x', 1))).toBeNull();
    expect(decodeEntityId('Service', '')).toBeNull();
    expect(decodeEntityId(undefined, svc('x', 1))).toBeNull();
    expect(decodeEntityId('UnknownScope', svc('x', 1))).toBeNull();
  });

  it('returns null on malformed input', () => {
    expect(decodeEntityId('Service', 'no-suffix')).toBeNull();
    expect(decodeEntityId('Endpoint', 'missing_underscore')).toBeNull();
    expect(decodeEntityId('EndpointRelation', 'only-three-parts-here')).toBeNull();
  });

  it('round-trips multi-byte names through UTF-8', () => {
    expect(decodeEntityId('Service', svc('日本語サービス', 1))).toBe('日本語サービス · real');
  });
});

describe('decodeMetricId', () => {
  it('minute bucket + service entity', () => {
    const id = `202605091036_${svc('checkout', 1)}`;
    expect(decodeMetricId('ServiceCpmMetrics', id)).toBe('2026-05-09 10:36 · checkout · real');
  });

  it('hour bucket + service entity', () => {
    const id = `2026050910_${svc('checkout', 1)}`;
    expect(decodeMetricId('ServiceCpmMetrics', id)).toBe('2026-05-09 10 · checkout · real');
  });

  it('day bucket + service entity', () => {
    const id = `20260509_${svc('checkout', 1)}`;
    expect(decodeMetricId('ServiceCpmMetrics', id)).toBe('2026-05-09 · checkout · real');
  });

  it('relation metric uses the relation entity scope', () => {
    const ent = `${svc('checkout', 1)}-${svc('catalog', 1)}`;
    const id = `202605091036_${ent}`;
    expect(decodeMetricId('ServiceRelationServerCpmMetrics', id)).toBe(
      '2026-05-09 10:36 · checkout (real) → catalog (real)',
    );
  });

  it('endpoint metric → Endpoint scope', () => {
    const ent = endpoint(svc('checkout', 1), '/api/orders');
    expect(decodeMetricId('EndpointRespTimeMetrics', `202605091036_${ent}`)).toBe(
      '2026-05-09 10:36 · checkout → /api/orders · real',
    );
  });

  it('most-specific scope wins (EndpointRelation beats Endpoint)', () => {
    const ent = [
      svc('checkout', 1),
      b64('/api/orders'),
      svc('catalog', 1),
      b64('/api/items/127'),
    ].join('-');
    expect(decodeMetricId('EndpointRelationCpmMetrics', `202605091036_${ent}`)).toBe(
      '2026-05-09 10:36 · checkout//api/orders → catalog//api/items/127',
    );
  });

  it('falls back to bucket-only when entity portion fails to decode', () => {
    expect(decodeMetricId('ServiceCpmMetrics', '202605091036_garbled-id')).toBe('2026-05-09 10:36');
  });

  it('returns null on non-numeric bucket or no underscore', () => {
    expect(decodeMetricId('ServiceCpmMetrics', 'not-a-bucket_foo')).toBeNull();
    expect(decodeMetricId('ServiceCpmMetrics', 'no_underscore_no_id')).toBe(
      'no_underscore_no_id'.match(/^(\d+)/) ? null /* bucket must be entirely numeric */ : null,
    );
    expect(decodeMetricId('ServiceCpmMetrics', 'noseparator')).toBeNull();
  });

  it('non-fixed-width bucket renders the raw digits', () => {
    expect(decodeMetricId('ServiceCpmMetrics', `12345_${svc('x', 1)}`)).toBe('12345 · x · real');
  });
});
