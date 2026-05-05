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
  LalPayload,
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
  return LAL_STAGES.has(rec.stage) && isLalPayload(rec.payload);
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

export function isLalPayload(p: RecordPayload): p is LalPayload {
  if (typeof p !== 'object' || p === null) return false;
  return 'sourceLine' in p && 'body' in p;
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
