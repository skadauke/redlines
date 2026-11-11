// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { accept, applyChanges, newestView, parse, reject } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  type Editor,
  type EditorOptions,
  type EditorUiState,
  undo,
} from '../index.ts';
import { previewDecorations } from '../preview/decorations.ts';
import { assignColors } from './colors.ts';
import { trackedDecorations } from './decorations.ts';
import { atomic, classes, list, visibleText, withoutBlankLines } from './test-helpers.ts';

// A path rather than a URL: under happy-dom, `URL` is the DOM's class, which node:fs rejects.
const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../format/src/fixtures/launch-plan.md'),
  'utf8',
);

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, ...options });
  open.push(editor);
  return editor;
}

/** A document with a ledger that gives each mark's author, and any other ledger lines. */
function withLedger(body: string, marks: Record<string, string>, more = ''): string {
  const entries = Object.entries(marks).map(
    ([id, by]) => `  ${id}: {by: ${by}, at: 2026-10-31T09:30Z}\n`,
  );
  const section = entries.length ? `marks:\n${entries.join('')}` : '';
  return `${body}\n\n<!-- redlines\nversion: 1\n${more}${section}-->\n`;
}

/** The ranges of decorations with a class. */
const classed = (editor: Editor, className: string) =>
  list(editor)
    .filter((d) => classes(d).includes(className))
    .map((d) => [d.from, d.to]);

/** The classes of the mark decorations that cover `pos`. */
const marksAt = (editor: Editor, pos: number) =>
  list(editor)
    .filter((d) => d.kind === 'mark' && d.from <= pos && pos < d.to)
    .flatMap(classes);

/** The classes the tracked layer gives line `n`. */
const lineClasses = (editor: Editor, n: number) =>
  list(editor)
    .filter((d) => d.kind === 'line' && d.from === editor.view.state.doc.line(n).from)
    .flatMap(classes);

describe('Redlines', () => {
  it('hides all markers and the ledger in Redlines', () => {
    const editor = load(fixture);
    expect(editor.getUiState().view).toBe('redlines');
    // Deleted and replaced text show in place of their markers.
    expect(visibleText(editor)).toBe(
      withoutBlankLines(
        '# Launch plan\n\nWe will ship the new importer in MarchApril, after the security review.' +
          ' The old exporter stays as it is.\n',
      ),
    );
  });

  it('classes inserted text', () => {
    const editor = load(fixture);
    const from = fixture.indexOf('new ');
    const insertion = list(editor).find((d) => d.kind === 'mark' && d.from === from);
    expect(insertion?.to).toBe(from + 'new '.length);
    expect(classes(insertion!)).toEqual(expect.arrayContaining(['rl-ins', 'rl-author-1']));
    // The new text of Claude for Ada's substitution, in Claude's color.
    expect(marksAt(editor, fixture.indexOf('April'))).toEqual(['rl-ins', 'rl-author-4']);
    // The text and its underline are drawn in the theme's first author color.
    editor.view.dom.parentElement!.style.setProperty('--rl-author-1', '#d42a1e');
    const drawn = editor.view.contentDOM.querySelector('.rl-ins.rl-author-1')!;
    expect(drawn.textContent).toBe('new ');
    expect(getComputedStyle(drawn).color).toBe('#d42a1e');
    expect(getComputedStyle(drawn).textDecorationColor).toBe('#d42a1e');
  });

  it('shows deleted text as a widget', () => {
    const editor = load(fixture);
    const from = fixture.indexOf('<!--del');
    const deletion = list(editor).find((d) => d.kind === 'replace' && d.from === from);
    expect(deletion).toMatchObject({
      to: fixture.indexOf('-->', from) + 3,
      widget: { text: ' The old exporter stays as it is.' },
    });
    expect(classes(deletion!.widget!)).toEqual(expect.arrayContaining(['rl-del', 'rl-author-3']));
    // A substitution's old text, struck in front of the new.
    const sub = list(editor).find((d) => d.from === fixture.indexOf('<!--sub'));
    expect(sub?.widget).toEqual({ text: 'March', className: 'rl-del rl-author-4' });
  });

  it("tints comment ranges in the author's tint", () => {
    const editor = load(fixture);
    const from = fixture.indexOf('security review');
    expect(classed(editor, 'rl-cmt')).toEqual([[from, from + 'security review'.length]]);
    expect(marksAt(editor, from)).toEqual(['rl-cmt', 'rl-author-3']);
  });

  it('draws a change bar in the author color, or gray where several people changed a line', () => {
    // Ada inserted, Claude for Ada substituted and Bo deleted on the same line.
    const editor = load(fixture);
    expect(lineClasses(editor, 3)).toEqual(['rl-bar', 'rl-bar-mixed']);
    expect(lineClasses(editor, 1)).toEqual([]);

    const doc = withLedger(
      'One <!--ins b2b2-->two<!--/b2b2-->.\n\nA <!--cmt c3c3-->comment<!--/c3c3--> is no change.',
      { b2b2: 'bo' },
      'comments:\n  c3c3:\n    by: bo\n    at: 2026-10-31T09:40Z\n    text: |-\n      Why?\n',
    );
    const single = load(doc);
    expect(lineClasses(single, 1)).toEqual(['rl-bar', 'rl-author-3']);
    expect(lineClasses(single, 3)).toEqual([]);
  });

  it('marks a point comment with a pin and leaves resolved comments untinted', () => {
    const thread = (id: string, resolved: boolean) =>
      `  ${id}:\n    by: bo\n    at: 2026-10-31T09:40Z\n` +
      (resolved ? '    resolved: ada 2026-10-31T10:00Z\n' : '') +
      `    text: |-\n      Note ${id}\n`;
    const doc = withLedger(
      'A point<!--cmt c3c3--> here, and <!--cmt d4d4-->settled<!--/d4d4--> text.',
      {},
      `comments:\n${thread('c3c3', false)}${thread('d4d4', true)}`,
    );
    const editor = load(doc);
    const pin = list(editor).find((d) => d.from === doc.indexOf('<!--cmt c3c3'));
    expect(pin?.widget).toEqual({ text: '', className: 'rl-cmt-point rl-author-3' });
    expect(classed(editor, 'rl-cmt')).toEqual([]);
    expect(visibleText(editor)).toBe(withoutBlankLines('A point here, and settled text.\n'));
  });

  it('dims ordinary HTML comments in Redlines and hides them in Clean', () => {
    const note = '<!-- TODO: check the dates -->';
    const own = '<!-- A note on a line of its own -->';
    const long = '<!-- A note\nover two lines -->';
    const doc = withLedger(
      `Plan <!--ins b2b2-->now<!--/b2b2--> ${note} later.\n\n${own}\n\nMiddle.\n\n${long}\n\nEnd.`,
      { b2b2: 'ada' },
    );
    const editor = load(doc);
    const [from, line, lines] = [doc.indexOf(note), doc.indexOf(own), doc.indexOf(long)];
    expect(classed(editor, 'rl-comment')).toEqual([
      [from, from + note.length],
      [line, line + own.length],
      [lines, lines + long.length],
    ]);
    editor.setViewMode('clean');
    expect(classed(editor, 'rl-comment')).toEqual([]);
    expect(visibleText(editor)).toBe(withoutBlankLines('Plan now  later.\n\nMiddle.\n\nEnd.\n'));
    expect(atomic(editor)).toContainEqual([from, from + note.length]);
  });

  // The Markdown parser's comment block runs on to the end of the line with the `-->`.
  it.each([
    ['a line', '<!-- note --> Real paragraph text.\n\nNext.\n', 'Real paragraph text.'],
    ['a quote line', '> <!-- note --> quoted text\n\nAfter.\n', 'quoted text'],
    ['two lines', 'Intro.\n\n<!-- one\ntwo --> trailing words\n\nEnd.\n', 'trailing words'],
    ['a list item', '- <!-- note --> item text\n- next item\n', 'item text'],
  ])('keeps the text after a comment that starts %s', (_, doc, text) => {
    const editor = load(doc);
    const lines = () => [...editor.view.contentDOM.querySelectorAll('.cm-line')];
    expect(editor.getUiState().view).toBe('clean');
    expect(visibleText(editor)).toContain(text);
    expect(lines().some((line) => line.textContent?.includes(text))).toBe(true);
    // The list items stay apart.
    expect(lines().some((line) => line.textContent?.includes('item textnext'))).toBe(false);
    expect(visibleText(editor)).not.toContain('item text- next');

    editor.setViewMode('redlines');
    expect(classed(editor, 'rl-comment')).toEqual([[doc.indexOf('<!--'), doc.indexOf('-->') + 3]]);
    expect(lines().some((line) => line.textContent?.includes(text))).toBe(true);
  });

  it('hides a comment line in Clean with the blank lines around it', () => {
    const between = load('One.\n\nTwo.\n\n<!-- c -->\nThree.\n');
    expect(visibleText(between)).toBe(withoutBlankLines('One.\n\nTwo.\n\nThree.\n'));
    const quoted = load('> One.\n>\n> <!-- c -->\n> Two.\n');
    expect(visibleText(quoted)).toBe(withoutBlankLines('> One.\n>\n> Two.\n'));
    const spaced = load('One.\n\n<!-- c -->\n\nTwo.\n');
    expect(visibleText(spaced)).toBe(withoutBlankLines('One.\n\nTwo.\n'));
    // Last in the file, it leaves no blank line at the end.
    const last = load('One.\n\nTwo.\n\n<!-- c -->');
    expect(visibleText(last)).toBe(withoutBlankLines('One.\n\nTwo.'));
  });

  it('never joins the text after a list bullet to a comment, which is no opener', () => {
    const doc = '- <!-- note -->\n  item text\n- next\n';
    const editor = load(doc);
    expect(editor.getUiState().view).toBe('clean');
    expect(visibleText(editor)).toBe(withoutBlankLines('- \n  item text\n- next\n'));
    expect(atomic(editor)).toContainEqual([doc.indexOf('<!--'), doc.indexOf('-->') + 3]);
  });

  it('hides each comment on a line, keeping the text between, and never an unclosed one', () => {
    const doc = '<!-- a --> kept <!-- b --> also kept\n\n<!-- never closed\n\nLast words.\n';
    const editor = load(doc);
    // A comment never closed is an HTML block to the end, whose blank lines are its own.
    expect(visibleText(editor)).toBe(' kept  also kept\n<!-- never closed\n\nLast words.\n');
  });

  it('marks an inserted line break with a pilcrow and a change bar, in Redlines only', () => {
    const doc = withLedger('One tw<!--split b2b2-->\no three.', { b2b2: 'bo' });
    const editor = load(doc, { showLineBreakMarks: true });
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: true });
    expect(editor.getUiState().changes.map((mark) => mark.id)).toEqual(['b2b2']);
    const split = list(editor).find((d) => d.from === doc.indexOf('<!--split'));
    // In a box that takes no room in the line.
    expect(split?.widget).toEqual({ text: '', className: 'rl-splits' });
    const mark = editor.view.contentDOM.querySelector('.rl-splits > .rl-split');
    expect(mark?.className).toBe('rl-split rl-author-3');
    expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-author-3']);
    expect(visibleText(editor)).toBe(withoutBlankLines('One tw\no three.\n'));
    editor.setViewMode('clean');
    expect(list(editor).flatMap(classes)).not.toContain('rl-split');
    expect(visibleText(editor)).toBe(withoutBlankLines('One tw\no three.\n'));
  });

  it("draws an unknown author's text in the second ink, with a gray bar", () => {
    // The mark has no ledger entry.
    const doc = withLedger('Text <!--ins bbbz-->by nobody<!--/bbbz--> here.', {});
    const editor = load(doc);
    expect(marksAt(editor, doc.indexOf('by nobody'))).toEqual(['rl-ins', 'rl-author-0']);
    expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-bar-mixed']);
    editor.view.dom.parentElement!.style.setProperty('--rl-ink-2', '#6e6e73');
    expect(getComputedStyle(editor.view.contentDOM.querySelector('.rl-ins')!).color).toBe(
      '#6e6e73',
    );
  });

  it('stops the caret after deleted text, before the hidden ledger', () => {
    const editor = load(fixture);
    const from = fixture.indexOf('<!--del');
    const lineEnd = fixture.indexOf('-->', from) + 3;
    expect(editor.view.moveByChar(EditorSelection.cursor(from), true).head).toBe(lineEnd);
  });

  it('lets the caret step over markers and the ledger, except in Raw', () => {
    const editor = load(fixture);
    const ranges = atomic(editor);
    const parsed = parse(fixture);
    const hidden = parsed.marks.flatMap((mark) =>
      mark.segments.flatMap((segment) =>
        segment.close ? [segment.open, segment.close] : [segment.open],
      ),
    );
    hidden.push(parsed.ledgerRange!);
    for (const range of hidden) {
      expect(ranges.some(([from, to]) => from <= range.from && range.to <= to)).toBe(true);
    }
    editor.setViewMode('raw');
    expect(atomic(editor)).toEqual([]);
  });

  it('wraps lines so that a space after a hidden marker never starts a line', () => {
    // happy-dom lays nothing out, so the style that does it is checked. CodeMirror pads hidden
    // markers with zero-width buffers, where a line may break. With its `break-spaces`, a space
    // after a marker that didn't fit at the end of a line started the next one. With `pre-wrap`,
    // a space at the end of a line hangs, and the line breaks after it.
    const editor = load(fixture);
    expect(getComputedStyle(editor.view.contentDOM).whiteSpace).toBe('pre-wrap');
    editor.setViewMode('clean');
    expect(getComputedStyle(editor.view.contentDOM).whiteSpace).toBe('pre-wrap');
  });

  it('places marks by CodeMirror positions in a CRLF file', () => {
    const crlf = fixture.replaceAll('\n', '\r\n');
    const editor = load(crlf);
    expect(editor.getDoc()).toBe(crlf);
    const from = fixture.indexOf('new ');
    expect(marksAt(editor, from)).toEqual(['rl-ins', 'rl-author-1']);
    expect(visibleText(editor)).toBe(visibleText(load(fixture)));
  });
});

describe('marker lines', () => {
  it('hides a line that holds only markers, with the blank line after an opener', () => {
    const doc = withLedger(
      'First paragraph.\n\n<!--ins b2b2-->\n\nA new paragraph.<!--/b2b2-->\n\n' +
        '<!--del c3c3 Note: -->\n\nThe importer ships in April.',
      { b2b2: 'ada', c3c3: 'bo' },
    );
    const editor = load(doc);
    expect(visibleText(editor)).toBe(
      withoutBlankLines(
        'First paragraph.\n\nA new paragraph.\n\nNote: The importer ships in April.\n',
      ),
    );
    const blocks = list(editor).filter((d) => d.block && d.kind === 'replace');
    // With the blank line above it, which is hidden as every blank line between blocks is.
    expect(blocks[0]).toMatchObject({
      from: doc.indexOf('<!--ins') - 1,
      to: doc.indexOf('A new') - 1,
    });
    // The deleted text starts the block it was deleted from, with that line's bar.
    expect(
      lineClasses(editor, editor.view.state.doc.lineAt(doc.indexOf('The importer')).number),
    ).toEqual(['rl-bar', 'rl-author-3']);
  });

  it('keeps a deletion that has no block below it on its own line', () => {
    // All the text deleted: the deleted text has nowhere below to go but the hidden ledger.
    const doc = withLedger('<!--del b2b2 # Title\\n\\nText.-->', { b2b2: 'bo' });
    const editor = load(doc, { showLineBreakMarks: true });
    expect(visibleText(editor)).toBe(withoutBlankLines('# Title¶¶Text.\n'));
    const deletion = list(editor).find((d) => d.widget);
    expect(deletion).toMatchObject({ from: 0, kind: 'replace' });
    // The caret can rest after it, at the end of the body.
    const end = doc.indexOf('-->') + 3;
    expect(atomic(editor)).toContainEqual([0, end]);
  });

  it('keeps the look of the block under a hidden marker line', () => {
    const doc = withLedger('Intro.\n\n<!--ins b2b2-->\n\n## A new heading<!--/b2b2-->', {
      b2b2: 'ada',
    });
    const editor = load(doc);
    expect(editor.view.contentDOM.querySelector('.rl-h2')?.textContent).toBe('A new heading');
  });

  it('opens a document that starts with a marker line with the caret on its first text', () => {
    const doc = withLedger('<!--ins b2b2-->\n\n# A new title<!--/b2b2-->\n\nText.', {
      b2b2: 'ada',
    });
    const editor = load(doc);
    expect(editor.view.state.selection.main.head).toBe(doc.indexOf('# A new title'));
    editor.setDoc(doc);
    expect(editor.view.state.selection.main.head).toBe(doc.indexOf('# A new title'));
  });

  it("puts a list item's text on its bullet's line", () => {
    const doc = withLedger('- one\n- <!--ins b2b2-->\n  two<!--/b2b2-->\n- three', { b2b2: 'ada' });
    const editor = load(doc);
    expect(visibleText(editor)).toBe(withoutBlankLines('- one\n- two\n- three\n'));
  });

  it('hides the line of a closer after a table, with the blank line before it', () => {
    const doc = withLedger(
      'Intro.\n\n<!--ins b2b2-->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!--/b2b2-->\n\nAfter.',
      { b2b2: 'ada' },
    );
    const editor = load(doc);
    expect(visibleText(editor)).toBe(
      withoutBlankLines('Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n'),
    );
  });
});

describe('line break marks', () => {
  // Bo's line breaks: one inserted in a paragraph, the break between two deleted, and a hard break
  // deleted, its two spaces and its line break (format §3.4).
  const inserted = withLedger('One tw<!--split b2b2-->\no three.', { b2b2: 'bo' });
  const deleted = withLedger('One.<!--del b2b2 \\n\\n-->Two.', { b2b2: 'bo' });
  const hardBreak = withLedger('One<!--del b2b2   \\n-->two.', { b2b2: 'bo' });
  const shown = { showLineBreakMarks: true };
  const struck = (editor: Editor) => editor.view.contentDOM.querySelector('.rl-del')?.textContent;

  it('draws no pilcrow for an inserted or a deleted line break by default, in any view', () => {
    for (const doc of [inserted, deleted, hardBreak]) {
      const editor = load(doc);
      const content = editor.view.contentDOM;
      // Nothing at all for line breaks alone, and the bar marks their line.
      expect(content.querySelector('.rl-split, .rl-del')).toBeNull();
      expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-author-3']);
      for (const view of ['redlines', 'clean', 'raw'] as const) {
        editor.setViewMode(view);
        expect(content.querySelector('.rl-split'), view).toBeNull();
        expect(content.textContent, view).not.toContain('¶');
      }
    }
    expect(visibleText(load(deleted))).toBe('One.Two.');
    expect(visibleText(load(hardBreak))).toBe('Onetwo.');
  });

  it('draws them when asked: a pilcrow at the break, and a struck one for each break deleted', () => {
    const editor = load(inserted, shown);
    expect(editor.view.contentDOM.querySelector('.rl-split.rl-author-3')).not.toBeNull();
    expect(struck(load(deleted, shown))).toBe('¶¶');
    expect(struck(load(hardBreak, shown))).toBe('  ¶');
  });

  it('keeps a deleted paragraph apart from the one beside it, while the marks are hidden', () => {
    // A whole paragraph deleted, in the middle, drawn at the start of the block below, and at the
    // end, after the paragraph above (format §3.4): its paragraph break is a space.
    for (const [body, hidden, marked] of [
      ['One.\n\n<!--del b2b2 Two.\\n\\n-->\n\nThree.', 'Two. ', 'Two.¶¶'],
      ['One.\n\nTwo.<!--del b2b2 \\n\\nThree.-->', ' Three.', '¶¶Three.'],
    ] as const) {
      const doc = withLedger(body, { b2b2: 'bo' });
      const editor = load(doc);
      expect(struck(editor)).toBe(hidden);
      const line = editor.view.contentDOM.querySelector('.rl-del')?.closest('.cm-line');
      expect(line?.textContent).toBe('Two. Three.');
      expect(struck(load(doc, shown))).toBe(marked);
    }
  });

  it('draws the pilcrow at the break in a list line too, which hangs', () => {
    // A break after an item's text, and one in front of it, as Enter there leaves them.
    for (const body of [
      '- Turn on Track Changes<!--split b2b2-->\n- a few words',
      '- <!--split b2b2-->\n- Keep',
    ]) {
      const editor = load(withLedger(body, { b2b2: 'bo' }), shown);
      const mark = editor.view.contentDOM.querySelector<HTMLElement>('.rl-split')!;
      // The line's negative text indent, inherited, would draw the pilcrow that far left of the
      // break: over the word before it, or over the bullet.
      expect(mark.closest('.rl-hang')).not.toBeNull();
      expect(getComputedStyle(mark).textIndent).toBe('0px');
    }
  });

  it("draws a second break's pilcrow next to the first, at the end of the line above", () => {
    // Enter behind Bo's paragraph break, as Enter three times in a paragraph leaves it, and with a
    // blank line, as Enter four times: the second break's marker stands alone on its line, which is
    // hidden. Its pilcrow, at the start of the block below, was drawn over its first letter.
    for (const body of [
      'A second paragraph, <!--split b2b2-->\n\n<!--split c3c3-->\nto join.',
      'A second paragraph, <!--split b2b2-->\n\n<!--split c3c3-->\n\nto join.',
    ]) {
      const doc = withLedger(body, { b2b2: 'bo', c3c3: 'ada' });
      const editor = load(doc, shown);
      const content = editor.view.contentDOM;
      const below = editor.view.state.doc.lineAt(doc.indexOf('to join.')).number;
      const [first, second, ...more] = content.querySelectorAll('.rl-split');
      expect(more).toEqual([]);
      // Side by side ("¶¶") in one box, each in its author's color.
      expect([first?.className, second?.className]).toEqual([
        'rl-split rl-author-3',
        'rl-split rl-author-1',
      ]);
      expect(second?.parentElement).toBe(first?.parentElement);
      expect(first?.closest('.cm-line')?.textContent).toBe('A second paragraph, ');
      // Their line takes the bar of both, and the line below none.
      expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-bar-mixed']);
      expect(lineClasses(editor, below)).toEqual([]);
      expect(visibleText(editor)).toBe(withoutBlankLines('A second paragraph, \n\nto join.\n'));
      // Hidden, neither draws anything, and the bars stay.
      editor.setShowLineBreakMarks(false);
      expect(content.querySelector('.rl-split')).toBeNull();
      expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-bar-mixed']);
      expect(lineClasses(editor, below)).toEqual([]);
    }
  });

  it('draws the pilcrow of a break alone on its line at the end of the text above', () => {
    // A break whose first half is empty, as another program may write it: the text above has no
    // pilcrow to stand beside.
    const doc = withLedger('Intro.\n\n<!--split c3c3-->\nto join.', { c3c3: 'ada' });
    const editor = load(doc, shown);
    const marks = [...editor.view.contentDOM.querySelectorAll('.rl-split')];
    expect(marks.map((mark) => mark.closest('.cm-line')?.textContent)).toEqual(['Intro.']);
    expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-author-1']);
    expect(lineClasses(editor, 4)).toEqual([]);
  });

  it('keeps apart the words that a deleted line break parted, while the marks are hidden', () => {
    const doc = withLedger(
      'Alpha one <!--del b2b2 two three.\\n\\n## Middle heading\\n\\nGamma four -->five six.',
      { b2b2: 'bo' },
    );
    expect(struck(load(doc))).toBe('two three. ## Middle heading Gamma four ');
    expect(struck(load(doc, shown))).toBe('two three.¶¶## Middle heading¶¶Gamma four ');
  });

  it('shows and hides the marks at once, in the document open and the ones opened after', () => {
    const editor = load(inserted);
    const content = editor.view.contentDOM;
    editor.setShowLineBreakMarks(true);
    expect(content.querySelector('.rl-split.rl-author-3')).not.toBeNull();
    editor.setDoc(deleted);
    expect(struck(editor)).toBe('¶¶');
    editor.setShowLineBreakMarks(false);
    expect(content.textContent).not.toContain('¶');
    expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-author-3']);
  });
});

describe('Clean', () => {
  it('Clean shows the newest text', () => {
    const editor = load(fixture);
    editor.setViewMode('clean');
    expect(visibleText(editor)).toBe(withoutBlankLines(newestView(fixture).text));
    const drawn = list(editor).flatMap(classes);
    expect(drawn.filter((c) => /^rl-(ins|del|cmt|bar)/.test(c))).toEqual([]);
  });
});

describe('Simple', () => {
  const comment =
    'comments:\n  c3c3:\n    by: bo\n    at: 2026-10-31T09:40Z\n    text: |-\n      Why?\n';
  /** Every kind of change the layer draws, each alone on a line or two, and a comment. */
  const kinds = withLedger(
    [
      'An <!--ins h8h8-->inserted<!--/h8h8--> word.',
      '',
      'A thing<!--del b2b2 deleted words-->gone.',
      '',
      'Kept above.',
      '',
      '<!--del d4d4 A paragraph removed whole.\\n\\n-->',
      '',
      'It was <!--sub j9j9 older-->old<!--/j9j9-->.',
      '',
      'One tw<!--split f6f6-->',
      'o three.',
      '',
      'Plain <!--fmt g7g7 +bold-->**words**<!--/g7g7--> here.',
      '',
      '<!--fmt q2hw was=p-->',
      '',
      '## Heading<!--/q2hw-->',
      '',
      '- [x] Buy milk<!--fmt k3x9 +check-->',
      '',
      'A <!--cmt c3c3-->comment<!--/c3c3--> and a point<!--cmt p4p4--> here.',
      '',
      'Unchanged.',
    ].join('\n'),
    {
      h8h8: 'ada',
      b2b2: 'bo',
      d4d4: 'ada',
      j9j9: 'claude-ada',
      f6f6: 'bo',
      g7g7: 'bo',
      q2hw: 'bo',
      k3x9: 'bo',
    },
    `${comment}  p4p4:\n    by: bo\n    at: 2026-10-31T09:40Z\n    text: |-\n      Here\n`,
  );
  const bars = (editor: Editor) =>
    list(editor)
      .filter((d) => d.kind === 'line' && classes(d).includes('rl-bar'))
      .map((d) => [d.from, d.className]);

  it('draws no .rl-ins, .rl-del, .rl-fmt, .rl-split or .rl-comment in Simple', () => {
    const editor = load(kinds + '\n<!-- TODO -->\n', { view: 'simple', showLineBreakMarks: true });
    const drawn = (): string[] =>
      list(editor).flatMap((d) => [...classes(d), ...(d.widget ? classes(d.widget) : [])]);
    expect(drawn().filter((c) => /^rl-(ins|del|fmt|split|comment)$/.test(c))).toEqual([]);
    expect(editor.view.contentDOM.querySelector('.rl-ins, .rl-del, .rl-fmt, .rl-split')).toBeNull();
    expect(editor.view.dom.classList).toContain('rl-view-simple');
    // The same document in Redlines does draw them.
    editor.setViewMode('redlines');
    expect(drawn()).toEqual(expect.arrayContaining(['rl-ins', 'rl-del', 'rl-fmt']));
  });

  it('draws comment tints and pins in Simple, as in Redlines', () => {
    const editor = load(kinds, { view: 'simple' });
    const simple = list(editor).filter((d) =>
      /rl-cmt/.test(d.className + (d.widget?.className ?? '')),
    );
    expect(simple.length).toBeGreaterThanOrEqual(2);
    editor.setViewMode('redlines');
    const redlines = list(editor).filter((d) =>
      /rl-cmt/.test(d.className + (d.widget?.className ?? '')),
    );
    expect(simple).toEqual(redlines);
    expect(simple.some((d) => classes(d).includes('rl-cmt'))).toBe(true);
    expect(simple.some((d) => d.widget?.className.includes('rl-cmt-point'))).toBe(true);
  });

  it('puts the same bar classes on the same lines in Simple as in Redlines, for every kind of change', () => {
    const editor = load(kinds, { view: 'simple' });
    const simple = bars(editor);
    editor.setViewMode('redlines');
    expect(simple.length).toBeGreaterThanOrEqual(5);
    expect(simple).toEqual(bars(editor));
  });

  it('puts the same bar classes on the same lines in Simple as in Redlines, for a table row', () => {
    const doc = withLedger(
      'Intro\n\n| Milestone | When |\n| --- | --- |\n| M3 | <!--sub r4tn January-->February<!--/r4tn--> |',
      { r4tn: 'claude-ada' },
    );
    const editor = load(doc, { view: 'simple' });
    const cell = () => editor.view.contentDOM.querySelectorAll('.rl-tc')[3]!;
    expect(cell().textContent).toBe('February');
    const row = editor.view.contentDOM.querySelectorAll('.rl-trow')[1]!;
    expect([...row.classList]).toEqual(['cm-line', 'rl-bar', 'rl-author-4', 'rl-trow']);
    expect(editor.view.contentDOM.querySelector('.rl-ins, .rl-del')).toBeNull();
  });

  it("shows the text Clean shows, and has Clean's atoms", () => {
    for (const doc of [fixture, kinds]) {
      const editor = load(doc, { view: 'clean' });
      const text = visibleText(editor);
      const atoms = atomic(editor);
      editor.setViewMode('simple');
      expect(visibleText(editor)).toBe(text);
      expect(atomic(editor)).toEqual(atoms);
    }
  });

  it('hides ordinary HTML comments and line break marks in Simple', () => {
    const doc = withLedger('One tw<!--split b2b2-->\no <!-- TODO --> three.', { b2b2: 'bo' });
    const editor = load(doc, { view: 'simple', showLineBreakMarks: true });
    expect(visibleText(editor)).not.toContain('TODO');
    expect(visibleText(editor)).not.toContain('¶');
    expect(classed(editor, 'rl-comment')).toEqual([]);
    expect(lineClasses(editor, 1)).toEqual(['rl-bar', 'rl-author-3']);
  });
});

describe('Raw', () => {
  it('Raw has no replace decorations', () => {
    const editor = load(fixture);
    editor.setViewMode('raw');
    const { state } = editor.view;
    expect(trackedDecorations(state).size).toBe(0);
    // The preview is off too: the source shows as written.
    expect(previewDecorations(state).size).toBe(0);
    expect(editor.view.contentDOM.querySelector('.rl-h1, .rl-ins, .rl-bar')).toBeNull();
    expect(editor.view.contentDOM.textContent).toContain('<!--ins k3x9-->new <!--/k3x9-->');
  });

  it('shows the source with markers in --rl-ink-2', () => {
    const editor = load(fixture, { view: 'raw' });
    expect(editor.view.dom.classList).toContain('rl-view-raw');
    editor.view.dom.parentElement!.style.setProperty('--rl-ink-2', '#6e6e73');
    const markers = [...editor.view.contentDOM.querySelectorAll('.rl-tok-comment')];
    expect(markers.map((m) => m.textContent)).toContain('<!--ins k3x9-->');
    expect(getComputedStyle(markers[0]!).color).toBe('#6e6e73');
    // The other views draw the document, without Raw's highlighting.
    editor.setViewMode('redlines');
    expect(editor.view.contentDOM.querySelector('[class*="rl-tok-"]')).toBeNull();
  });

  it('moves the caret out of a marker when Raw is left', () => {
    const editor = load(fixture, { view: 'raw' });
    editor.view.dispatch({ selection: { anchor: fixture.indexOf('k3x9') } });
    editor.setViewMode('redlines');
    const marker = { from: fixture.indexOf('<!--ins'), to: fixture.indexOf('new ') };
    expect([marker.from, marker.to]).toContain(editor.view.state.selection.main.head);
  });
});

describe('assignColors', () => {
  const colorsOf = (text: string, me: string) => Object.fromEntries(assignColors(parse(text), me));

  it('gives you the first color, and everyone else the color of their handle', () => {
    expect(colorsOf(fixture, 'ada')).toEqual({ ada: 1, bo: 3, 'claude-ada': 4 });
    expect(colorsOf(fixture, 'bo')).toEqual({ bo: 1, ada: 5, 'claude-ada': 4 });
    expect(colorsOf(fixture, 'cy')).toEqual({ cy: 1, ada: 5, bo: 3, 'claude-ada': 4 });
  });

  it('keeps each person’s color when changes are decided', () => {
    const before = colorsOf(fixture, 'cy');
    // Ada's insertion and Claude's substitution, the first changes in the text, are decided.
    let text = fixture;
    for (const [decide, id] of [
      [accept, 'k3x9'],
      [reject, 'p7qd'],
    ] as const) {
      text = applyChanges(text, decide(text, id));
    }
    expect(parse(text).marks.map(({ entry }) => entry.by)).toEqual(['bo', 'bo']);
    expect(colorsOf(text, 'cy')).toEqual(before);
  });

  it('tells apart two people whose handles have the same color', () => {
    // Ada's and Claude's handles both have the fifth color: Ada, first by handle, keeps it.
    const text = withLedger('<!--ins bbb2-->One<!--/bbb2--> <!--ins bbb3-->two<!--/bbb3-->', {
      bbb2: 'claude',
      bbb3: 'ada',
    });
    expect(colorsOf(text, 'me')).toEqual({ me: 1, ada: 5, claude: 6 });
  });

  it('gives an unknown author gray, and repeats colors past the palette', () => {
    const ids = ['bbb2', 'bbb3', 'bbb4', 'bbb5', 'bbb6', 'bbb7', 'bbb8', 'bbb9'];
    const body = [...ids, 'bbbz'].map((id) => `<!--ins ${id}-->${id} <!--/${id}-->`).join('');
    // The last mark has no ledger entry: its author is unknown.
    const authors = Object.fromEntries(ids.map((id, i) => [id, `p${i + 1}`]));
    const colors = assignColors(parse(withLedger(`Text ${body}`, authors)), 'ada');
    // Seven people take the seven other colors; the eighth repeats the color of their handle.
    const seven = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((p) => colors.get(p));
    expect(seven.toSorted()).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(colors.get('p8')).toBe(colors.get('p1'));
    expect(colors.get('ada')).toBe(1);
    expect(colors.get('unknown')).toBe(0);
  });
});

describe('ui state', () => {
  it('uiState.hasRedlines is true for the fixture and false for a plain file', () => {
    expect(load(fixture).getUiState()).toMatchObject({ hasRedlines: true, view: 'redlines' });
    expect(load('# Plain\n\nNo marks.\n').getUiState()).toEqual({
      view: 'clean',
      markupView: 'redlines',
      tracking: false,
      hasRedlines: false,
      changes: [],
      activeCommands: [],
      enabledCommands: [],
      undo: null,
      redo: null,
      canUndo: false,
      canRedo: false,
    });
  });

  it('counts changes, comments, highlights and format changes as redlines', () => {
    const highlight = withLedger('A <!--hl h4kz-->bright<!--/h4kz--> idea.', { h4kz: 'bo' });
    expect(load(highlight).getUiState()).toMatchObject({ hasRedlines: true, view: 'redlines' });
    const formatted = withLedger('Plain <!--fmt m2bd +bold-->**words**<!--/m2bd-->.', {
      m2bd: 'bo',
    });
    const editor = load(formatted);
    expect(editor.getUiState()).toMatchObject({ hasRedlines: true, view: 'redlines' });
    expect(editor.getUiState().changes.map((mark) => mark.id)).toEqual(['m2bd']);
    // A format change that accept and reject can't decide is no change to list.
    const kept = withLedger('Plain <!--fmt m2bd +mark-->==words==<!--/m2bd-->.', { m2bd: 'bo' });
    expect(load(kept).getUiState()).toMatchObject({ hasRedlines: false, changes: [] });
  });

  it('lists pending changes in document order and reports the view', () => {
    const reports: EditorUiState[] = [];
    const editor = load(fixture, { onUiState: (state) => reports.push(state) });
    expect(editor.getUiState().changes.map((mark) => mark.id)).toEqual(['k3x9', 'p7qd', 'w2rf']);
    expect(editor.getParsed().marks.map((mark) => mark.id)).toEqual([
      'k3x9',
      'p7qd',
      'c8d2',
      'w2rf',
    ]);
    editor.setViewMode('raw');
    expect(reports.map((state) => state.view)).toEqual(['raw']);
    expect(editor.getUiState().view).toBe('raw');
  });
});

describe('loading', () => {
  const plain = '# Plain\n\nNo marks.\n';
  const everyone = withLedger(
    'Ship <!--ins b2b2-->it<!--/b2b2-->.',
    { b2b2: 'bo' },
    'tracking: everyone\n',
  );

  it('starts from the defaults: Redlines for redlines, tracking for everyone', () => {
    expect(load(everyone).getUiState()).toMatchObject({ view: 'redlines', tracking: true });
    expect(load(everyone, { view: 'raw', tracking: false }).getUiState()).toMatchObject({
      view: 'raw',
      tracking: false,
    });
  });

  it('setDoc re-applies the view and tracking defaults', () => {
    const reports: EditorUiState[] = [];
    const editor = load(plain, { onUiState: (state) => reports.push(state) });
    editor.setViewMode('raw');
    editor.setDoc(everyone);
    expect(editor.getUiState()).toMatchObject({
      view: 'redlines',
      tracking: true,
      hasRedlines: true,
    });
    expect(reports.at(-1)).toMatchObject({ view: 'redlines', tracking: true, hasRedlines: true });
    editor.setDoc(plain);
    expect(reports.at(-1)).toMatchObject({ view: 'clean', tracking: false, hasRedlines: false });
  });

  it('reloadDoc keeps the selection and scroll position', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the document.`);
    const file = `${lines.join('\n')}\n`;
    const editor = load(file);
    const at = editor.view.state.doc.line(5).from + 4;
    editor.view.dispatch({ selection: { anchor: at, head: at + 3 } });
    editor.view.scrollDOM.scrollTop = 120;
    const firstLine = editor.view.contentDOM.querySelector('.cm-line');
    const changed = file.replace('Line 51 ', 'A line Claude added.\nLine 51 ');
    editor.reloadDoc(changed);
    expect(editor.getDoc()).toBe(changed);
    expect(editor.view.state.selection.main).toMatchObject({ anchor: at, head: at + 3 });
    expect(editor.view.scrollDOM.scrollTop).toBe(120);
    // The lines above the change aren't drawn again, so nothing above it moves.
    expect(editor.view.contentDOM.querySelector('.cm-line')).toBe(firstLine);
  });

  it('reloadDoc is not an edit to undo, and starts the history over', () => {
    const editor = load('One.\n\nTwo.\n');
    editor.view.dispatch({ changes: { from: 0, insert: 'Mine. ' } });
    editor.reloadDoc('Mine. One.\n\nTwo.\n\nTheirs.\n');
    // The edit was made to the old version, and isn't replayed over the new one.
    expect(undo(editor.view)).toBe(false);
    expect(editor.getDoc()).toBe('Mine. One.\n\nTwo.\n\nTheirs.\n');
  });

  it('reloadDoc keeps the view unless the document gains redlines in Clean', () => {
    const reports: EditorUiState[] = [];
    const editor = load(plain, { onUiState: (state) => reports.push(state) });
    editor.reloadDoc(fixture);
    expect(reports.at(-1)).toMatchObject({ view: 'redlines', hasRedlines: true });

    // Clean chosen for a document with redlines stays Clean, and Raw stays Raw.
    editor.setViewMode('clean');
    editor.reloadDoc(fixture.replace('April', 'May'));
    expect(editor.getUiState().view).toBe('clean');
    editor.setViewMode('raw');
    editor.reloadDoc(plain);
    editor.reloadDoc(fixture);
    expect(editor.getUiState().view).toBe('raw');
  });

  it('stays in Redlines when the last redline goes away', () => {
    const reports: EditorUiState[] = [];
    const editor = load(everyone, { onUiState: (state) => reports.push(state) });
    expect(editor.getUiState().view).toBe('redlines');
    editor.reloadDoc(plain);
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: false });
    expect(reports.at(-1)).toMatchObject({ view: 'redlines', hasRedlines: false });

    // Also when an edit removes it, and when the last change is decided.
    editor.setDoc(everyone);
    const { doc } = editor.view.state;
    editor.view.dispatch({ changes: { from: 0, to: doc.length, insert: 'Ship it.\n' } });
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: false });
    editor.setDoc(everyone);
    editor.accept('b2b2');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: false });
  });

  it('shows a document without redlines in Redlines when that is chosen, and keeps it there', () => {
    const editor = load(plain);
    expect(editor.getUiState().view).toBe('clean');
    editor.setViewMode('redlines');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: false });
    editor.view.dispatch({ changes: { from: 0, insert: 'More. ' } });
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: false });
    // A document opened afterwards starts from its own default again.
    editor.setDoc(plain);
    expect(editor.getUiState().view).toBe('clean');
  });

  describe('reloadDoc with the selection where the file changed', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the document.`);
    const file = `${lines.join('\n')}\n`;
    /** An agent's edits on lines 2 and 58. */
    const edited = file
      .replace('Line 2 of', 'Line two of')
      .replace('Line 58 of the document.', 'Line 58 of the document, edited.');

    it('maps a selection inside the replaced text without turning it over', () => {
      const editor = load('Hello brave new world');
      editor.view.dispatch({ selection: { anchor: 8, head: 10 } });
      editor.reloadDoc('Hello bold new world\n');
      const { main } = editor.view.state.selection;
      expect(main.from).toBeLessThanOrEqual(main.to);
      // Typing over it works.
      editor.view.dispatch(editor.view.state.replaceSelection('X'));
      expect(editor.view.state.doc.toString()).toContain('X');
    });

    it('keeps a selection that spans the replaced text, in its direction', () => {
      const editor = load('Hello brave new world');
      editor.view.dispatch({ selection: { anchor: 13, head: 2 } });
      editor.reloadDoc('Hello bold new world');
      expect(editor.view.state.selection.main).toMatchObject({ anchor: 12, head: 2 });
      editor.view.dispatch(editor.view.state.replaceSelection('X'));
      expect(editor.view.state.doc.toString()).toBe('HeXew world');
    });

    it('keeps a caret between two changed stretches on its line', () => {
      const editor = load(file);
      const line = editor.view.state.doc.line(30);
      editor.view.dispatch({ selection: { anchor: line.from + 5 } });
      const drawn = [...editor.view.contentDOM.querySelectorAll('.cm-line')].find((el) =>
        el.textContent?.startsWith('Line 30 '),
      );
      editor.reloadDoc(edited);
      const after = editor.view.state.selection.main.head;
      expect(editor.view.state.doc.lineAt(after).text).toBe('Line 30 of the document.');
      expect(after - editor.view.state.doc.lineAt(after).from).toBe(5);
      // The lines between the changes aren't drawn again.
      expect(drawn?.isConnected).toBe(true);
    });

    it('keeps a selection in unchanged text', () => {
      const editor = load(file);
      const from = file.indexOf('Line 30 ');
      editor.view.dispatch({ selection: { anchor: from, head: from + 7 } });
      editor.reloadDoc(edited);
      const { main } = editor.view.state.selection;
      expect(editor.view.state.sliceDoc(main.from, main.to)).toBe('Line 30');
    });

    it('undoes the edits made after the reload, and none from before it', () => {
      const editor = load(file);
      const at = file.indexOf('Line 30 ');
      editor.view.dispatch({ changes: { from: at, insert: 'Mine. ' } });
      const reloaded = edited.replace('Line 30 ', 'Mine. Line 30 ');
      editor.reloadDoc(reloaded);
      editor.view.dispatch({ changes: { from: at, insert: 'Again. ' } });
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(reloaded);
      expect(undo(editor.view)).toBe(false);
    });

    it('tells other extensions that the change came from outside', () => {
      const seen: { remote: boolean; reload: boolean }[] = [];
      const editor = load(file, {
        extensions: [
          EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              const remote = tr.annotation(Transaction.remote) === true;
              seen.push({ remote, reload: tr.isUserEvent('reload') });
            }
          }),
        ],
      });
      editor.reloadDoc(edited);
      expect(seen).toEqual([{ remote: true, reload: true }]);
    });

    it('moves the caret off a line that the new version hides', () => {
      const doc = withLedger('One.\n\n\n\nTwo.', { b2b2: 'ada' });
      const editor = load(doc);
      const blank = doc.indexOf('\n\n\n') + 2;
      editor.view.dispatch({ selection: { anchor: blank } });
      // An agent adds a paragraph there, with its own-line opener above it.
      editor.reloadDoc(
        doc.replace('\n\n\n\nTwo.', '\n\n<!--ins b2b2-->\n\nNew.<!--/b2b2-->\n\nTwo.'),
      );
      const head = editor.view.state.selection.main.head;
      const hidden = editor.view.state.doc.toString().indexOf('<!--ins');
      expect(head < hidden || head > hidden + '<!--ins b2b2-->\n'.length).toBe(true);
    });
  });

  it("reloadDoc takes the new file's line endings", () => {
    const editor = load('one\r\ntwo\nthree\n');
    editor.reloadDoc('one\ntwo\r\nthree\n');
    expect(editor.getDoc()).toBe('one\ntwo\r\nthree\n');
    const end = editor.view.state.doc.line(3).to;
    editor.view.dispatch({ changes: { from: end, insert: '!' } });
    expect(editor.getDoc()).toBe('one\ntwo\r\nthree!\n');
  });
});

describe('tables', () => {
  const doc = withLedger(
    'Intro\n\n| Milestone | When |\n| --- | --- |\n| M3 | <!--sub r4tn January-->February<!--/r4tn--> |',
    { r4tn: 'claude-ada' },
  );

  it('draws cell marks in the cell, as anywhere', () => {
    const editor = load(doc);
    const cells = () => editor.view.contentDOM.querySelectorAll<HTMLElement>('.rl-tc');
    const cell = () => cells()[3]!;
    expect(cell().textContent).toBe('JanuaryFebruary');
    expect(cell().querySelector('.rl-del.rl-author-4')?.textContent).toBe('January');
    expect(cell().querySelector('.rl-ins.rl-author-4')?.textContent).toBe('February');
    // The row's change bar, on its line: its first cell draws it.
    const row = cells()[2]!.closest('.cm-line')!;
    expect([...row.classList]).toContain('rl-bar');
    expect([...row.classList]).toContain('rl-author-4');

    editor.setViewMode('clean');
    expect(cell().textContent).toBe('February');
    expect(editor.view.contentDOM.querySelector('.rl-ins, .rl-del, .rl-bar')).toBeNull();
  });
});

describe('format changes', () => {
  it('underlines a format change, dotted, in its author’s color, in Redlines only', () => {
    const doc = withLedger('Plain <!--fmt m2bd +bold-->**words**<!--/m2bd--> here.', {
      m2bd: 'bo',
    });
    const editor = load(doc);
    const parsed = parse(doc);
    const { content } = parsed.marks[0]!.segments[0]!;
    expect(classed(editor, 'rl-fmt')).toEqual([[content.from, content.to]]);
    // Bo's color, as his inserted text would have.
    expect(marksAt(editor, doc.indexOf('words'))).toEqual(['rl-fmt', 'rl-author-3']);
    // Its operations are not deleted text, and draw nothing.
    expect(list(editor).some((d) => d.widget?.className.includes('rl-del'))).toBe(false);
    expect(
      getComputedStyle(editor.view.contentDOM.querySelector('.rl-fmt')!).textDecorationStyle,
    ).toBe('dotted');
    editor.setViewMode('clean');
    expect(classed(editor, 'rl-fmt')).toEqual([]);
  });

  it('draws a format change with nothing after its carrier as nothing, and never as inserted', () => {
    const doc = withLedger('- <!--fmt m2bd +bold-->\n  <!--/m2bd-->Text here', { m2bd: 'bo' });
    const editor = load(doc);
    expect(classed(editor, 'rl-ins')).toEqual([]);
    expect(classed(editor, 'rl-fmt')).toEqual([]);
  });

  it('underlines the text of a block whose type changed, and draws nothing for a box', () => {
    const doc = withLedger(
      '<!--fmt q2hw was=p-->\n\n## Heading<!--/q2hw-->\n\n- [x] Buy milk<!--fmt k3x9 +check-->',
      { q2hw: 'bo', k3x9: 'bo' },
    );
    const editor = load(doc);
    const heading = parse(doc).marks[0]!.segments[0]!;
    expect(classed(editor, 'rl-fmt')).toEqual([[heading.carrier!.to, heading.content.to]]);
    expect(editor.getUiState().changes.map((mark) => mark.id)).toEqual(['q2hw', 'k3x9']);
    expect(list(editor).some((d) => (d.widget?.text ?? '') !== '')).toBe(false);
  });
});
