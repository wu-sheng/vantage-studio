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
 * encoding rules so the OAL debug payload's raw entityId (`base64(name)
 * + "." + layerOrdinal` and friends) can be rendered with a
 * decoded-name annotation next to it. Per-scope formats — see
 * IDManager.java + Layer.java in the OAP repo:
 *
 *   Service             base64(name).layerOrdinal
 *   ServiceInstance     <serviceId>_base64(name)
 *   Endpoint            <serviceId>_base64(name)
 *   ServiceRelation     <srcSvcId>-<dstSvcId>
 *   ServiceInstanceRel  <srcInstId>-<dstInstId>
 *   EndpointRelation    <srcSvcId>-base64(srcEndpoint)-<dstSvcId>-base64(dstEndpoint)
 *
 * The shape alone isn't fully unambiguous (instance and endpoint share
 * the same `_`-joined layout), so the OAL source class — passed via
 * the payload's `type` field — is what tells us which scope to apply.
 *
 * Decoding is best-effort: any malformed input falls back to `null`,
 * the caller renders the raw id without an annotation.
 */

const LAYERS: Record<number, string> = {
  0: 'UNDEFINED',
  1: 'MESH',
  2: 'GENERAL',
  3: 'OS_LINUX',
  4: 'K8S',
  5: 'FAAS',
  6: 'MESH_CP',
  7: 'MESH_DP',
  8: 'DATABASE',
  9: 'CACHE',
  10: 'BROWSER',
  11: 'SO11Y_OAP',
  12: 'SO11Y_SATELLITE',
  13: 'MQ',
  14: 'VIRTUAL_DATABASE',
  15: 'VIRTUAL_MQ',
  16: 'VIRTUAL_GATEWAY',
  17: 'K8S_SERVICE',
  18: 'MYSQL',
  19: 'VIRTUAL_CACHE',
  20: 'POSTGRESQL',
  21: 'APISIX',
  22: 'AWS_EKS',
  23: 'OS_WINDOWS',
  24: 'AWS_S3',
  25: 'AWS_DYNAMODB',
  26: 'AWS_GATEWAY',
  27: 'REDIS',
  28: 'ELASTICSEARCH',
  29: 'RABBITMQ',
  30: 'MONGODB',
  31: 'KAFKA',
  32: 'PULSAR',
  33: 'BOOKKEEPER',
  34: 'NGINX',
  35: 'ROCKETMQ',
  36: 'CLICKHOUSE',
  37: 'ACTIVEMQ',
  38: 'CILIUM_SERVICE',
  39: 'SO11Y_JAVA_AGENT',
  40: 'KONG',
  41: 'SO11Y_GO_AGENT',
  42: 'FLINK',
  43: 'BANYANDB',
  44: 'GENAI',
  45: 'VIRTUAL_GENAI',
  46: 'ENVOY_AI_GATEWAY',
  47: 'IOS',
  48: 'WECHAT_MINI_PROGRAM',
  49: 'ALIPAY_MINI_PROGRAM',
};

function layerName(ord: number): string {
  return LAYERS[ord] ?? `layer-${ord}`;
}

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
  layer: string;
}

/** Service id = base64(name).layerOrdinal — exactly one dot. */
function decodeService(id: string): ServiceParts | null {
  const dot = id.lastIndexOf('.');
  if (dot < 0) return null;
  const name = fromBase64(id.slice(0, dot));
  const ord = Number(id.slice(dot + 1));
  if (name === null || !Number.isFinite(ord)) return null;
  return { name, layer: layerName(ord) };
}

/** ServiceInstance / Endpoint id = <serviceId>_base64(name). The
 *  serviceId itself contains a dot, so we split on the LAST `_` to
 *  get the trailing base64 leaf. */
function decodeChildOfService(id: string): { service: ServiceParts; leaf: string } | null {
  const us = id.lastIndexOf('_');
  if (us < 0) return null;
  const svc = decodeService(id.slice(0, us));
  if (!svc) return null;
  const leaf = fromBase64(id.slice(us + 1));
  if (leaf === null) return null;
  return { service: svc, leaf };
}

/** Public decoder. The OAL payload's `type` field discriminates the
 *  scope; without a hint we return null. Returns a short
 *  human-readable annotation suitable for inline display. */
export function decodeEntityId(type: string | undefined, id: string): string | null {
  if (!type || !id) return null;
  switch (type) {
    case 'Service': {
      const s = decodeService(id);
      return s ? `${s.name} · ${s.layer}` : null;
    }
    case 'ServiceInstance': {
      const r = decodeChildOfService(id);
      return r ? `${r.service.name} → ${r.leaf} · ${r.service.layer}` : null;
    }
    case 'Endpoint': {
      const r = decodeChildOfService(id);
      return r ? `${r.service.name} → ${r.leaf} · ${r.service.layer}` : null;
    }
    case 'ServiceRelation': {
      const dash = id.indexOf('-');
      if (dash < 0) return null;
      const src = decodeService(id.slice(0, dash));
      const dst = decodeService(id.slice(dash + 1));
      if (!src || !dst) return null;
      return `${src.name} (${src.layer}) → ${dst.name} (${dst.layer})`;
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
      // 4 segments: srcSvcId - base64(srcEp) - dstSvcId - base64(dstEp).
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
