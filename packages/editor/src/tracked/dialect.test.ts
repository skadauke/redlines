// @vitest-environment happy-dom
// A `.qmd` is edited by pandoc's rules and a `.md` by the plain ones (format §9.1): the editor names
// the dialect of the open file in every edit it asks the format library for.

import { forceParsing } from '@codemirror/language';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';

const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const BODY = '# Intro {#sec-intro}\n\nSee @fig-plot here.\n\n::: {.callout-note}\nA note.\n:::\n';
const DOC = `${BODY}\n<!-- redlines\nversion: 1\ntracking: everyone\n-->\n`;

function typeInto(dialect: 'gfm' | 'pandoc', at: number): string {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: DOC,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    dialect,
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  editor.view.dispatch({ changes: { from: at, insert: 'X' }, userEvent: 'input.type' });
  return editor.view.state.doc.toString();
}

describe('the open file’s dialect', () => {
  it('keeps a mark out of a reference in a pandoc file, and not in a Markdown one', () => {
    const at = DOC.indexOf('@fig-plot') + 5;
    const pandoc = typeInto('pandoc', at);
    const plain = typeInto('gfm', at);
    // The key is whole in a pandoc file, whatever the marker's place; in `.md` the marker is
    // written where it was typed, inside the text.
    expect(pandoc).not.toMatch(/@fig-<!--/);
    expect(plain).toMatch(/@fig-<!--/);
    expect(newestView(pandoc).text).toContain('@fig-Xplot');
    expect(newestView(plain).text).toContain('@fig-Xplot');
  });

  it('keeps a mark off a fence line in a pandoc file', () => {
    const at = DOC.indexOf('{.callout-note}') + 3;
    const pandoc = typeInto('pandoc', at);
    for (const line of pandoc.split('\n')) {
      if (/^:::/.test(line)) expect(line).not.toContain('<!--');
    }
    expect(typeInto('gfm', at)).toMatch(/^:::.*<!--/m);
  });
});
