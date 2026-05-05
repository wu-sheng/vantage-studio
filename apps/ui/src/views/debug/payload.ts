/*
 * Copyright 2026 The Vantage Studio Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Helpers that discriminate `record.payload` by `record.stage`.
 *
 * SWIP-13's actual wire emits one `SessionRecord` shape with a
 * `stage` field carrying values across all three DSLs. The recorder
 * picks the payload variant per stage; these predicates let the per-
 * DSL views narrow the union without an `as` cast leaking everywhere.
 */

import type {
  LalBlockPayload,
  LalLinePayload,
  MalMeterPayload,
  MalSamplesPayload,
  OalMetricsPayload,
  OalSourcePayload,
  RecordPayload,
  SessionRecord,
  Stage,
} from '@vantage-studio/api-client';

const MAL_STAGES: ReadonlySet<Stage> = new Set([
  'input',
  'filter',
  'stage',
  'scope',
  'downsample',
  'meterBuild',
  'meterEmit',
]);
const LAL_STAGES: ReadonlySet<Stage> = new Set([
  'text',
  'parser',
  'extractor',
  'outputRecord',
  'outputMetric',
  'line',
]);
const OAL_STAGES: ReadonlySet<Stage> = new Set([
  'source',
  'filter',
  'build',
  'aggregation',
  'emit',
]);

/** `filter` is a stage shared by MAL and OAL. The payload shape
 *  resolves the ambiguity — MAL filter is a SamplesPayload (has
 *  `samples` / `empty`), OAL filter is a SourcePayload (has `type`). */

export function isMalRecord(rec: SessionRecord): boolean {
  if (!MAL_STAGES.has(rec.stage)) return false;
  if (rec.stage !== 'filter') return true;
  return isMalSamplesPayload(rec.payload);
}

export function isLalRecord(rec: SessionRecord): boolean {
  if (!LAL_STAGES.has(rec.stage)) return false;
  // `line` records carry the wrapped {sourceLine, body} shape; block
  // stages carry the flat body directly. Either is acceptable.
  return rec.stage === 'line'
    ? isLalLinePayload(rec.payload)
    : isLalBlockPayload(rec.payload);
}

export function isOalRecord(rec: SessionRecord): boolean {
  if (!OAL_STAGES.has(rec.stage)) return false;
  if (rec.stage !== 'filter') return true;
  return isOalSourcePayload(rec.payload);
}

export function isMalSamplesPayload(p: RecordPayload): p is MalSamplesPayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'samples' in p || 'empty' in p;
}

export function isMalMeterPayload(p: RecordPayload): p is MalMeterPayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'metric' in p && 'entity' in p && 'value' in p;
}

/** LAL `line` stage payload: `{ sourceLine, body: {...} }`. */
export function isLalLinePayload(p: RecordPayload): p is LalLinePayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'sourceLine' in p && 'body' in p;
}

/** LAL block-stage payload: flat `{ aborted?, hasOutput?, hasParsed?,
 *  extra? }` — emitted by text / parser / extractor / outputRecord /
 *  outputMetric. */
export function isLalBlockPayload(p: RecordPayload): p is LalBlockPayload {
  if (typeof p !== 'object' || p === null) return false;
  if ('sourceLine' in p) return false; // that's a line record
  // Heuristic: all the boolean ctx flags are optional; require the
  // payload to look like a context summary by accepting empty bodies
  // too (minimal upstream may emit `{}` for trivial probes).
  return true;
}

export function isOalSourcePayload(p: RecordPayload): p is OalSourcePayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'type' in p && 'scope' in p && !('timeBucket' in p);
}

export function isOalMetricsPayload(p: RecordPayload): p is OalMetricsPayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'type' in p && 'timeBucket' in p;
}

/** Short-form a SHA-256 hex into the first 8 chars (or `—` when empty). */
export function shortHash(h: string | undefined | null): string {
  if (!h) return '—';
  return h.slice(0, 8);
}

/**
 * Pill tone for a stage badge. Centralised across MAL / LAL / OAL
 * views so a tone tweak lands in one place.
 *
 * Tones reflect pipeline progression: `source`/`input`/`text` are the
 * entry points (ok); `filter` is the gate (warn); transforms /
 * builders are info; the L1-bound terminal stages
 * (`meterEmit`/`emit`/`outputRecord`/`outputMetric`) are active so
 * operators eyes catch them; LAL `line` is warn (statement-mode
 * burns the record cap fast).
 */
export function stageTone(stage: Stage): 'ok' | 'warn' | 'info' | 'dim' | 'active' {
  switch (stage) {
    case 'meterEmit':
    case 'emit':
    case 'outputRecord':
    case 'outputMetric':
      return 'active';
    case 'meterBuild':
    case 'build':
    case 'aggregation':
    case 'parser':
    case 'extractor':
      return 'info';
    case 'filter':
    case 'line':
      return 'warn';
    case 'input':
    case 'source':
    case 'text':
      return 'ok';
    default:
      return 'dim';
  }
}
