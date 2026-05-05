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
 * Helpers for rendering arrays that may carry the "+N more"
 * truncation marker SWIP-13 §5 introduces.
 *
 * The wire shape isn't formally pinned — could be a plain string
 * `"+12 more"` or an object `{truncated: 12, note: "..."}` or
 * `{more: 12}`. These helpers tolerate all three.
 */

import type { TruncationMarker } from '@vantage-studio/api-client';

/** True when the value looks like a truncation marker rather than a
 *  real entry. */
export function isTruncationMarker(v: unknown): v is TruncationMarker | string {
  if (typeof v === 'string') {
    // Heuristic — `+12 more`, `+12 more chars truncated`.
    return /^\s*\+\s*\d+\s+(more|chars?\s+truncated)/i.test(v);
  }
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.truncated === 'number' || typeof o.more === 'number';
}

export function describeTruncation(v: TruncationMarker | string): string {
  if (typeof v === 'string') return v;
  const n = v.truncated ?? v.more ?? 0;
  return `+${n} more${v.note ? ` · ${v.note}` : ''}`;
}

/** Split an array of items into the real entries and a single
 *  trailing truncation summary (when present). */
export function splitTruncation<T>(arr: readonly (T | TruncationMarker | string)[] | undefined): {
  entries: T[];
  truncation: string | null;
} {
  if (!arr) return { entries: [], truncation: null };
  const entries: T[] = [];
  let truncation: string | null = null;
  for (const item of arr) {
    if (isTruncationMarker(item)) {
      truncation = describeTruncation(item);
    } else {
      entries.push(item as T);
    }
  }
  return { entries, truncation };
}
