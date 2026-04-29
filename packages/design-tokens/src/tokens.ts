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
 * Design tokens — ported 1:1 from `shared.jsx` in the design bundle.
 *
 * The matching `tokens.css` exposes every token here as a CSS custom
 * property of the form `--rr-<key>`, so Vue components style themselves
 * via `var(--rr-bg)` etc. and never hard-code a colour. The TS export is
 * for any code that needs the values programmatically (e.g. echarts
 * theme objects, canvas rendering, tests).
 *
 * Pro dev-tool aesthetic. Warm-charcoal dark default. Inter for UI
 * chrome, JetBrains Mono for code/values/hashes/DSL. One amber accent.
 */

export const RR_FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
export const RR_FONT_UI = "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif";

/** Dark theme — the canvas default. */
export const rrDark = {
  bg: '#15130f',
  bg2: '#1b1814',
  bg3: '#221e19',
  panel: '#1e1b16',
  border: '#2b2721',
  border2: '#393329',
  dim: '#6b6359',
  ink: '#d9d2c5',
  ink2: '#a8a094',
  heading: '#efeadb',
  accent: 'oklch(0.82 0.14 75)',
  accentDim: 'oklch(0.62 0.11 75)',
  active: '#f3b35a',
  ok: '#7fbf7a',
  warn: '#e5a84a',
  err: '#e87166',
  info: '#6ba3d6',
  violet: '#a990e6',
} as const;

/** Light theme — companion; the design canvas is ~always dark. */
export const rrLight = {
  bg: '#f6f3ec',
  bg2: '#ecead9',
  bg3: '#e4e1d0',
  panel: '#ffffff',
  border: '#d6d1c2',
  border2: '#c2bca9',
  dim: '#8a8475',
  ink: '#2a2721',
  ink2: '#5a5548',
  heading: '#141210',
  accent: 'oklch(0.58 0.14 60)',
  accentDim: 'oklch(0.70 0.11 60)',
  active: '#b8772a',
  ok: '#3e8a48',
  warn: '#b37a15',
  err: '#c14a3e',
  info: '#2e6da6',
  violet: '#6b4bbf',
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
