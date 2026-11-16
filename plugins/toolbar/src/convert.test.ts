// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { holds } from './convert.ts';

const mounted: Editor[] = [];
afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  '# Title', // 0
  '',
  'A paragraph of text.',
  '',
  '- one',
  '- two',
  '',
  '```',
  'code',
  '',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| c | d |',
  '',
].join('\n');

/** What a selection holds in `doc`, by the positions of its ends. */
function holdsBetween(doc: string, anchor: number, head = anchor) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: { handle: 'ada', name: 'Ada' } });
  mounted.push(editor);
  forceParsing(editor.view, doc.length, 1000);
  editor.view.dispatch({ selection: { anchor, head } });
  return holds(editor.view.state);
}

/** What the selection holds in `DOC`, from where `from` starts to where `to` ends (a caret in `from` alone). */
function holdsAt(from: string, to?: string) {
  const start = DOC.indexOf(from) + 1;
  return to === undefined
    ? holdsBetween(DOC, start)
    : holdsBetween(DOC, DOC.indexOf(from), DOC.indexOf(to) + to.length);
}

describe('what a selection holds for the List menu', () => {
  it('holds a paragraph where the caret is in one', () => {
    expect(holdsAt('paragraph')).toEqual({ paragraph: true, item: false });
    expect(holdsAt('paragraph').item).toBe(false);
  });

  it('holds the block a caret is at the edge of, from either side', () => {
    const paragraph = DOC.indexOf('A paragraph');
    expect(holdsBetween(DOC, paragraph).paragraph).toBe(true);
    expect(holdsBetween(DOC, paragraph + 'A paragraph of text.'.length).paragraph).toBe(true);
    const item = DOC.indexOf('- two');
    expect(holdsBetween(DOC, item + 2).item).toBe(true);
    expect(holdsBetween(DOC, item + '- two'.length).item).toBe(true);
    // The end of a heading is no paragraph's edge.
    expect(holdsBetween(DOC, DOC.indexOf('Title') + 5)).toEqual({ paragraph: false, item: false });
  });

  it('holds only the blocks a range reaches: not the next one, when it ends at its first character', () => {
    const start = DOC.indexOf('# Title');
    const next = DOC.indexOf('A paragraph');
    // A triple-click on the heading takes its line break, and ends at the start of the paragraph.
    expect(holdsBetween(DOC, start, next)).toEqual({ paragraph: false, item: false });
    expect(holdsBetween(DOC, start, next + 1).paragraph).toBe(true);
  });

  it('holds a list item where the caret is in one', () => {
    // A list item holds its own paragraph.
    expect(holdsAt('two')).toEqual({ paragraph: true, item: true });
  });

  it('holds nothing in a heading, a code block or a table', () => {
    expect(holdsAt('Title')).toEqual({ paragraph: false, item: false });
    expect(holdsAt('code')).toEqual({ paragraph: false, item: false });
    expect(holdsAt('c | d')).toEqual({ paragraph: false, item: false });
  });

  it('holds what a range reaches, not only what it starts in: from a heading into a paragraph', () => {
    expect(holdsAt('Title', 'paragraph')).toMatchObject({ paragraph: true });
  });

  it('holds both for a range over a paragraph and a list', () => {
    expect(holdsAt('paragraph', 'two')).toEqual({ paragraph: true, item: true });
  });

  it('holds a paragraph for a caret on an empty line, where a list can be started', () => {
    const doc = 'First.\n\n\nSecond.\n';
    expect(holdsBetween(doc, 7)).toMatchObject({ paragraph: true });
    // Not an empty line inside a code block.
    const fenced = '```\ncode\n\nmore\n```\n';
    expect(holdsBetween(fenced, fenced.indexOf('\n\n') + 1)).toEqual({
      paragraph: false,
      item: false,
    });
  });
});
