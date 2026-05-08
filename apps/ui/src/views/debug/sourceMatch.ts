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
 * Map a captured `sample.sourceText` back to source-body line numbers.
 *
 * The upstream SWIP-13 polish made `sourceText` byte-matchable against
 * the rule body — for MAL chain stages, OAL filter clauses, and the
 * MAL file-level filter literal, the wire emits the verbatim ANTLR
 * slice (`sum(['service_name', 'step'])`,
 * `.filter(detectPoint == DetectPoint.SERVER)`,
 * `{ tags -> tags.x == 'y' }`). `String.indexOf` over the body finds
 * every occurrence; we convert each offset to a 1-based line number
 * for the source-pane gutter.
 *
 * Returns a sorted unique list. Multiple matches are common — the
 * same chain method (`sum(...)`) can appear several times in one
 * rule. The pane highlights every one; the operator gets visual
 * confirmation of which clause they're inspecting.
 *
 * Note: the `FilterExpression(literal=...)` wrapper that earlier MAL
 * probes emitted has been removed — the recorder now ships the inner
 * literal directly, so no unwrap step is needed.
 */
export function findLineMatches(content: string, needle: string): number[] {
  if (!content || !needle) return [];
  const trimmed = needle.trim();
  if (trimmed.length === 0) return [];

  const seen = new Set<number>();
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(trimmed, from);
    if (idx === -1) break;
    let line = 1;
    for (let i = 0; i < idx; i++) {
      if (content.charCodeAt(i) === 10 /* \n */) line += 1;
    }
    seen.add(line);
    from = idx + trimmed.length;
  }
  return [...seen].sort((a, b) => a - b);
}
