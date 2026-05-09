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

/**
 * Mirrors `org.apache.skywalking.oap.server.core.analysis.IDManager`'s
 * encoding rules so the OAL debug payload's raw `entityId` (and the
 * metric row's `id`) can be rendered with a decoded annotation next
 * to it.
 *
 * Per-scope formats — see IDManager.java:
 *
 *   Service             base64(name).<isNormal>          (isNormal ∈ {0,1})
 *   ServiceInstance     <serviceId>_base64(name)
 *   Endpoint            <serviceId>_base64(name)
 *   ServiceRelation     <srcSvcId>-<dstSvcId>
 *   ServiceInstanceRel  <srcInstId>-<dstInstId>
 *   EndpointRelation    <srcSvcId>-base64(srcEp)-<dstSvcId>-base64(dstEp)
 *
 * The trailing digit on a Service id is the boolean `isNormal` flag —
 * `1` for real (agent-instrumented / user-defined), `0` for virtual
 * (synthesised, e.g. virtual-database / virtual-mq peers). NOT the
 * layer ordinal — the layer lives elsewhere on the source object.
 *
 * Metric storage `id` is `<timeBucket>_<entityId>` per
 * `StorageID.build()` (joined by `Const.ID_CONNECTOR = "_"`). The
 * first segment is a numeric bucket (`yyyyMMddHHmm` / `yyyyMMddHH` /
 * `yyyyMMdd` depending on downsampling).
 *
 * The shape alone isn't fully unambiguous (instance and endpoint
 * share the same `_`-joined layout), so the source class — passed
 * via the payload's `type` field — is what selects the right
 * per-scope decoder. Decoding is best-effort: any malformed input
 * falls back to `null` and the caller renders the raw id without an
 * annotation.
 */

/** UTF-8 base64 → string. Uses the browser's native `atob` and
 *  reconstructs UTF-8 via `TextDecoder` so non-ASCII names survive
 *  the round-trip (atob alone returns latin-1 bytes). */
function fromBase64(s: string): string | null {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

interface ServiceParts {
  name: string;
  /** OAP's `isNormal` flag — `true` for real services, `false` for
   *  synthesised peers (virtual database, virtual cache, etc.). */
  real: boolean;
}

/** Service id = base64(name).<0|1> — the trailing digit is the
 *  isNormal boolean. Anything else returns null. */
function decodeService(id: string): ServiceParts | null {
  const dot = id.lastIndexOf('.');
  if (dot < 0) return null;
  const name = fromBase64(id.slice(0, dot));
  const flag = id.slice(dot + 1);
  if (name === null || (flag !== '0' && flag !== '1')) return null;
  return { name, real: flag === '1' };
}

function realLabel(p: ServiceParts): string {
  return p.real ? 'real' : 'virtual';
}

/** ServiceInstance / Endpoint id = <serviceId>_base64(name). The
 *  serviceId itself contains a dot (the isNormal flag), so we split
 *  on the LAST `_` to get the trailing base64 leaf. */
function decodeChildOfService(id: string): { service: ServiceParts; leaf: string } | null {
  const us = id.lastIndexOf('_');
  if (us < 0) return null;
  const svc = decodeService(id.slice(0, us));
  if (!svc) return null;
  const leaf = fromBase64(id.slice(us + 1));
  if (leaf === null) return null;
  return { service: svc, leaf };
}

/** Public decoder for `entityId`. The OAL payload's `type` field
 *  discriminates the scope; without a hint we return null. */
export function decodeEntityId(type: string | undefined, id: string): string | null {
  if (!type || !id) return null;
  switch (type) {
    case 'Service': {
      const s = decodeService(id);
      return s ? `${s.name} · ${realLabel(s)}` : null;
    }
    case 'ServiceInstance':
    case 'Endpoint': {
      const r = decodeChildOfService(id);
      return r ? `${r.service.name} → ${r.leaf} · ${realLabel(r.service)}` : null;
    }
    case 'ServiceRelation': {
      const dash = id.indexOf('-');
      if (dash < 0) return null;
      const src = decodeService(id.slice(0, dash));
      const dst = decodeService(id.slice(dash + 1));
      if (!src || !dst) return null;
      return `${src.name} (${realLabel(src)}) → ${dst.name} (${realLabel(dst)})`;
    }
    case 'ServiceInstanceRelation': {
      const dash = id.indexOf('-');
      if (dash < 0) return null;
      const src = decodeChildOfService(id.slice(0, dash));
      const dst = decodeChildOfService(id.slice(dash + 1));
      if (!src || !dst) return null;
      return `${src.service.name}/${src.leaf} → ${dst.service.name}/${dst.leaf}`;
    }
    case 'EndpointRelation': {
      // 4 dash-joined segments: srcSvcId - base64(srcEp) - dstSvcId - base64(dstEp).
      // Service ids contain `.` but no `-`, so a 3-dash split is safe.
      const parts = id.split('-');
      if (parts.length !== 4) return null;
      const srcSvc = decodeService(parts[0]!);
      const dstSvc = decodeService(parts[2]!);
      const srcEp = fromBase64(parts[1]!);
      const dstEp = fromBase64(parts[3]!);
      if (!srcSvc || !dstSvc || srcEp === null || dstEp === null) return null;
      return `${srcSvc.name}/${srcEp} → ${dstSvc.name}/${dstEp}`;
    }
    default:
      return null;
  }
}

/** Format a numeric time bucket (yyyyMMddHHmm / yyyyMMddHH /
 *  yyyyMMdd) as `YYYY-MM-DD HH:MM` / `YYYY-MM-DD HH` / `YYYY-MM-DD`.
 *  Returns the raw string when the bucket isn't one of the three
 *  fixed widths. */
function formatTimeBucket(bucket: string): string {
  if (!/^\d+$/.test(bucket)) return bucket;
  if (bucket.length === 12) {
    return `${bucket.slice(0, 4)}-${bucket.slice(4, 6)}-${bucket.slice(6, 8)} ${bucket.slice(8, 10)}:${bucket.slice(10, 12)}`;
  }
  if (bucket.length === 10) {
    return `${bucket.slice(0, 4)}-${bucket.slice(4, 6)}-${bucket.slice(6, 8)} ${bucket.slice(8, 10)}`;
  }
  if (bucket.length === 8) {
    return `${bucket.slice(0, 4)}-${bucket.slice(4, 6)}-${bucket.slice(6, 8)}`;
  }
  return bucket;
}

/** Heuristic: the metric class's `type` field ("Service…", "Endpoint…",
 *  …) tells us which entity-id scope its `id` row joins onto. Order
 *  matters — most specific first (EndpointRelation must beat
 *  Endpoint, ServiceInstanceRelation must beat ServiceInstance). */
function metricScopeOf(type: string): string | null {
  if (type.startsWith('EndpointRelation')) return 'EndpointRelation';
  if (type.startsWith('ServiceInstanceRelation')) return 'ServiceInstanceRelation';
  if (type.startsWith('ServiceRelation')) return 'ServiceRelation';
  if (type.startsWith('ServiceInstance')) return 'ServiceInstance';
  if (type.startsWith('Endpoint')) return 'Endpoint';
  if (type.startsWith('Service')) return 'Service';
  return null;
}

/** Decode an OAL metric storage `id` (`<timeBucket>_<entityId>`).
 *  Returns the formatted bucket plus the decoded entityId when both
 *  parse cleanly, the bucket alone when entityId decoding fails, or
 *  null when the bucket itself doesn't look numeric. */
export function decodeMetricId(type: string | undefined, id: string): string | null {
  if (!id) return null;
  const us = id.indexOf('_');
  if (us < 0) return null;
  const bucket = id.slice(0, us);
  if (!/^\d+$/.test(bucket)) return null;
  const formatted = formatTimeBucket(bucket);
  const entityRaw = id.slice(us + 1);
  const scope = type ? metricScopeOf(type) : null;
  const decoded = scope ? decodeEntityId(scope, entityRaw) : null;
  return decoded ? `${formatted} · ${decoded}` : formatted;
}

/** Decode the standalone `entityId` field on a metric payload. The
 *  metric class name (e.g. `ServiceCpmMetrics`,
 *  `ServiceRelationServerCpmMetrics`) tells us which entity scope
 *  the value belongs to — same prefix lookup as `decodeMetricId`,
 *  but applied to a bare entityId rather than a `<bucket>_<entityId>`
 *  composite. Used by the OAL view to annotate metric rows where
 *  the recorder serialises `entityId` alongside the storage `id`. */
export function decodeMetricEntityId(type: string | undefined, id: string): string | null {
  if (!type || !id) return null;
  const scope = metricScopeOf(type);
  if (!scope) return null;
  return decodeEntityId(scope, id);
}
