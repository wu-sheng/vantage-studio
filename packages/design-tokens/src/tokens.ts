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
 * Design tokens — derived from the Vantage Studio control-tower mark
 * (cool steel-navy ground + crimson VS monogram + cyan circuit
 * highlights). The brand reads as "mission-control console for
 * SkyWalking's runtime-rule pipeline" — operator-facing, dark by
 * default, restrained chrome with one assertive accent.
 *
 * The matching `tokens.css` exposes every token here as a CSS custom
 * property of the form `--rr-<key>`, so Vue components style themselves
 * via `var(--rr-bg)` etc. and never hard-code a colour. The TS export
 * is for any code that needs the values programmatically (e.g.
 * echarts theme objects, canvas rendering, tests).
 *
 * Inter for UI chrome, JetBrains Mono for code/values/hashes/DSL.
 */

export const RR_FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
export const RR_FONT_UI = "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif";

/** Dark theme — the canvas default. Steel-navy ground, crimson
 *  primary accent (lifted straight from the VS letterform), cyan
 *  info (the logo's circuit-trace highlights). */
export const rrDark = {
  bg: '#0d141a',
  bg2: '#131c24',
  bg3: '#1c2630',
  panel: '#182128',
  border: '#232f39',
  border2: '#354352',
  dim: '#5e6c79',
  ink: '#c8d1d9',
  ink2: '#8a96a3',
  heading: '#e6edf3',
  accent: '#e23a48',
  accentDim: '#a52837',
  active: '#e23a48',
  ok: '#4ec9b0',
  warn: '#f0b454',
  err: '#ff5e5e',
  info: '#6db4d6',
  violet: '#b794e4',
} as const;

/** Light theme — companion. Mirrors the dark palette with the same
 *  hue choices at higher luminance; crimson stays the primary accent
 *  but darkens to keep contrast over the cool light ground. */
export const rrLight = {
  bg: '#f0f3f6',
  bg2: '#e3e8ed',
  bg3: '#d3dae1',
  panel: '#ffffff',
  border: '#c0c8d0',
  border2: '#aab2bb',
  dim: '#6e7783',
  ink: '#1c2530',
  ink2: '#4a5666',
  heading: '#0a1118',
  accent: '#c91f2c',
  accentDim: '#a01821',
  active: '#c91f2c',
  ok: '#2c8f7a',
  warn: '#b4801a',
  err: '#c92e3e',
  info: '#2576a8',
  violet: '#6b4ec0',
} as const;

export type ThemeKey = keyof typeof rrDark;
export type Theme = Record<ThemeKey, string>;
export type ThemeName = 'dark' | 'light';

export const THEMES: Record<ThemeName, Theme> = {
  dark: rrDark,
  light: rrLight,
};

/** All token keys, in stable order — used by tests + any tooling that
 *  walks the table (e.g. a CSS-property generator). */
export const TOKEN_KEYS: readonly ThemeKey[] = Object.freeze(Object.keys(rrDark) as ThemeKey[]);

/** Spacing scale — 4-pt base, matches the prototype's padding/margin choices. */
export const SPACING = {
  '0': '0',
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '8': '32px',
  '10': '40px',
  '12': '48px',
} as const;

export const RADIUS = {
  sm: '3px',
  md: '4px',
  lg: '6px',
} as const;
