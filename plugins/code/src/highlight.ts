// Syntax colors for code (design: Rendering): the theme's --rl-code-* tokens, set on a few families
// of tags. Everything else in code stays the text color. Grammars come from @codemirror/language-data,
// which loads each on demand: a dynamic import per language, so none of it is in the first load.

import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';

const color = (kind: string) => ({ color: `var(--rl-code-${kind})` });

/** The colors, as a style that can also be run over a tree. */
export const codeStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    ...color('keyword'),
  },
  { tag: [t.string, t.special(t.string), t.regexp], ...color('string') },
  { tag: [t.number, t.bool, t.null, t.atom], ...color('number') },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    ...color('comment'),
    fontStyle: 'italic',
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    ...color('function'),
  },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], ...color('type') },
  { tag: [t.operator, t.punctuation], color: 'var(--rl-ink-2)' },
]);

/** Colors code wherever the editor shows it. */
export const codeHighlight: Extension = syntaxHighlighting(codeStyle);

/** The language for a fence's info string (`ts`, `python`), or null when there is none. */
export function codeLanguages(info: string): LanguageDescription | null {
  const word = info.trim().split(/\s+/)[0] ?? '';
  return word === '' ? null : LanguageDescription.matchLanguageName(languages, word, true);
}

/** Loads a language by its info string, as the editor does when it meets the block. */
export async function loadCodeLanguage(info: string): Promise<void> {
  await codeLanguages(info)?.load();
}

/** The language for a file name, or null: `main.ts`, `Makefile`, `Dockerfile`. */
export function languageForFile(name: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, name);
}
