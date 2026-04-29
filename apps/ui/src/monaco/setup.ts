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
 * One-time Monaco wiring: register the warm-charcoal "rr-dark" theme,
 * a worker factory, and DSL completion providers for MAL + LAL keyed
 * on the editor's catalog.
 *
 * Idempotent — `setupMonaco()` is safe to call from every editor
 * mount; the actual registration runs only once per process.
 */

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import type { Catalog } from '@vantage-studio/api-client';
import { rrDark } from '@vantage-studio/design-tokens';
import {
  MAL_DOWNSAMPLINGS,
  MAL_FUNCTIONS,
  MAL_SCOPES,
  MAL_TOP_KEYS,
  type DslEntry,
} from './mal-grammar.js';
import {
  LAL_BLOCK_KEYWORDS,
  LAL_EXTRACTOR_FUNCS,
  LAL_RULE_KEYS,
  LAL_TOP_KEYS,
} from './lal-grammar.js';

let initialised = false;

export const RR_THEME_NAME = 'rr-dark';

interface MonacoGlobal {
  MonacoEnvironment?: monaco.Environment;
}

export function setupMonaco(): void {
  if (initialised) return;
  initialised = true;

  (globalThis as MonacoGlobal).MonacoEnvironment = {
    getWorker(): Worker {
      return new EditorWorker();
    },
  };

  monaco.editor.defineTheme(RR_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string', foreground: rrDark.ink2.replace('#', '') },
      { token: 'number', foreground: rrDark.info.replace('#', '') },
      { token: 'comment', foreground: rrDark.dim.replace('#', ''), fontStyle: 'italic' },
      { token: 'keyword', foreground: rrDark.active.replace('#', '') },
      { token: 'type', foreground: rrDark.violet.replace('#', '') },
    ],
    colors: {
      'editor.background': rrDark.bg2,
      'editor.foreground': rrDark.ink,
      'editorLineNumber.foreground': rrDark.dim,
      'editorLineNumber.activeForeground': rrDark.ink2,
      'editor.lineHighlightBackground': rrDark.bg3,
      'editorCursor.foreground': rrDark.active,
      'editor.selectionBackground': '#3a3329',
      'editorIndentGuide.background': rrDark.border,
      'editorIndentGuide.activeBackground': rrDark.border2,
      'editor.findMatchBackground': '#5a4019',
    },
  });

  registerCompletions();
}

function registerCompletions(): void {
  monaco.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: ['.', ':', '\n', ' '],
    provideCompletionItems(model, position) {
      const catalog = (model as monaco.editor.ITextModel & { __vsCatalog?: Catalog }).__vsCatalog;
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const entries = entriesForCatalog(catalog);
      return {
        suggestions: entries.map((e) => toSuggestion(e, range)),
      };
    },
  });
}

function entriesForCatalog(catalog: Catalog | undefined): DslEntry[] {
  if (catalog === 'lal') {
    return [...LAL_TOP_KEYS, ...LAL_RULE_KEYS, ...LAL_BLOCK_KEYWORDS, ...LAL_EXTRACTOR_FUNCS];
  }
  // MAL — both otel-rules and log-mal-rules use the same DSL.
  return [...MAL_TOP_KEYS, ...MAL_SCOPES, ...MAL_DOWNSAMPLINGS, ...MAL_FUNCTIONS];
}

function toSuggestion(entry: DslEntry, range: monaco.IRange): monaco.languages.CompletionItem {
  return {
    label: entry.label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail: entry.detail,
    insertText: entry.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  };
}

/** Tag a model with its catalog so the global completion provider can
 *  filter MAL vs. LAL suggestions. Set this once after `monaco.editor.create`. */
export function setModelCatalog(model: monaco.editor.ITextModel, catalog: Catalog): void {
  (model as monaco.editor.ITextModel & { __vsCatalog?: Catalog }).__vsCatalog = catalog;
}
