// @vitest-environment happy-dom
// Return in paragraphs, headings and quotes (design: block editing, the matrix's Paragraphs,
// Headings and Quotes), with Track Changes off and on. `file` is what the file gets (the empty
// paragraph never), `caret` the text as it is, with the caret.
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { type Script, scriptRows, type Step } from './script.ts';

interface Row {
  name: string;
  doc: string;
  keys?: Step[];
  others?: string;
  off: Script['expect'];
  on: Script['expect'];
  skipOn?: Script['skip'];
}

/** Each row with Track Changes off and on. */
const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: false,
      expect: row.off,
      ...(row.others ? { others: row.others } : {}),
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: row.keys ?? ['Enter'],
      tc: true,
      expect: row.on,
      ...(row.others ? { others: row.others } : {}),
      ...(row.skipOn ? { skip: row.skipOn } : {}),
    },
  ]);

/** The same file and caret with Track Changes off and on: a Return the format writes plain. */
const plain = (file: string, caret: string) => ({ off: { file, caret }, on: { file, caret } });

/**
 * The format refuses a single line break at a soft break with Track Changes on (rejecting its split
 * would take the soft line break with it), so the two it writes there read as one; accepted, they
 * leave a blank line more (design: block editing, the Call on Return at a soft line break).
 */
const TWO_BREAKS =
  'The paragraph break goes in front of the soft line break as two line breaks, which read as ' +
  "one: the design's probed form";

/** A ledger for a document whose marker `q2hw` is Bo's. */
const BO = '⏎⏎<!-- redlines⏎version: 1⏎marks:⏎  q2hw: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';

describe('Return in a paragraph', () => {
  scriptRows(
    both([
      {
        name: 'at the end of the text',
        doc: 'One two.‸⏎⏎Next.',
        ...plain('One two.⏎⏎Next.', 'One two.⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'at the end, then text typed',
        doc: 'One two.‸⏎⏎Next.',
        keys: ['Enter', { type: 'X' }],
        off: { file: 'One two.⏎⏎X⏎⏎Next.' },
        on: {
          file: 'One two.⏎⏎<ins>⏎⏎X</ins>⏎⏎Next.',
          newest: 'One two.⏎⏎X⏎⏎Next.',
          // The Return's line breaks were plain: rejecting the paragraph leaves them, which read
          // as the one blank line that was there.
          original: 'One two.⏎⏎⏎⏎Next.',
        },
      },
      {
        name: "at the end, right before another person's split (review B+C I3)",
        doc: `One two.‸<!--split q2hw-->⏎⏎Next.${BO}`,
        ...plain('One two.<split>⏎⏎Next.', 'One two.<split>⏎⏎‸⏎⏎Next.'),
      },
      {
        name: "at the end, right before another person's split, then text typed",
        doc: `One two.‸<!--split q2hw-->⏎⏎Next.${BO}`,
        keys: ['Enter', { type: 'X' }],
        off: { file: 'One two.<split>⏎⏎X⏎⏎Next.' },
        on: { file: 'One two.<split>⏎⏎<ins>⏎⏎X</ins>⏎⏎Next.', newest: 'One two.⏎⏎X⏎⏎Next.⏎' },
      },
      {
        name: 'at the end, the next block right under it',
        doc: 'Intro:‸⏎- a',
        ...plain('Intro:⏎- a', 'Intro:⏎⏎‸⏎⏎- a'),
      },
      {
        name: 'at the end of the last block',
        doc: 'One two.‸⏎',
        ...plain('One two.⏎', 'One two.⏎⏎‸⏎'),
      },
      {
        name: 'at the end of the text, with no line break after it',
        doc: 'One two.‸',
        ...plain('One two.', 'One two.⏎⏎‸'),
      },
      {
        name: 'in the middle of the text',
        doc: 'One ‸two.',
        off: { file: 'One ⏎⏎two.', caret: 'One ⏎⏎‸two.' },
        on: { file: 'One <split>⏎⏎two.', caret: 'One <split>⏎⏎‸two.' },
      },
      {
        name: 'at a soft line break',
        doc: 'One two‸⏎three.',
        off: { file: 'One two⏎⏎three.', caret: 'One two⏎⏎‸three.' },
        on: { file: 'One two<split>⏎⏎⏎three.', caret: 'One two<split>⏎⏎⏎‸three.' },
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: 'at the start of a later line’s indented text',
        doc: 'One two⏎  ‸three.',
        off: { file: 'One two⏎⏎  three.', caret: 'One two⏎⏎  ‸three.' },
        on: { caret: 'One two<split>⏎⏎⏎  ‸three.' },
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: 'in a later line’s indentation: as at the start of its text (review D I12)',
        doc: 'One two⏎ ‸ three.',
        off: { file: 'One two⏎⏎  three.', caret: 'One two⏎⏎  ‸three.' },
        on: { caret: 'One two<split>⏎⏎⏎  ‸three.' },
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: 'at the start of the text',
        doc: 'One.⏎⏎‸Two.',
        ...plain('One.⏎⏎Two.', 'One.⏎⏎⏎⏎‸Two.'),
      },
      {
        name: 'at the start of the text, then ↑ into the empty paragraph',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Enter', 'ArrowUp'],
        ...plain('One.⏎⏎Two.', 'One.⏎⏎‸⏎⏎Two.'),
      },
      {
        name: 'at the start of the first block',
        doc: '‸One two.',
        ...plain('One two.', '⏎⏎‸One two.'),
      },
      {
        name: 'in the empty paragraph: nothing',
        doc: 'One two.‸⏎⏎Next.',
        keys: ['Enter', 'Enter'],
        ...plain('One two.⏎⏎Next.', 'One two.⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'again at the start of a block whose empty paragraph is open above it: nothing',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Enter', 'Enter'],
        ...plain('One.⏎⏎Two.', 'One.⏎⏎⏎⏎‸Two.'),
      },
      {
        name: 'at the end of a block whose empty paragraph is open below it: into it',
        doc: 'One two.‸⏎⏎Next.',
        keys: ['Enter', 'ArrowLeft', 'Enter'],
        ...plain('One two.⏎⏎Next.', 'One two.⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'at the end of the last block before the ledger',
        doc: 'One <ins>two</ins>.‸',
        // The body ends at the ledger: the empty paragraph opens above it.
        ...plain('One <ins>two</ins>.', 'One <ins>two</ins>.⏎⏎‸'),
      },
    ]),
  );
});

describe('Backspace right after Return', () => {
  scriptRows(
    both([
      {
        name: 'takes back the Return at the end of a block, right under which the next one is',
        doc: '## Head‸⏎Para.',
        keys: ['Enter', 'Backspace'],
        ...plain('## Head⏎Para.', '## Head‸⏎Para.'),
      },
      {
        name: 'takes back two Returns one at a time',
        doc: 'One ‸two.',
        keys: ['Enter', 'Enter', 'Backspace', 'Backspace'],
        ...plain('One two.', 'One ‸two.'),
      },
      {
        name: 'takes back the Returns that left a quote, one at a time',
        doc: '> One two.‸⏎⏎After.',
        keys: ['Enter', 'Enter', 'Backspace', 'Backspace'],
        ...plain('> One two.⏎⏎After.', '> One two.‸⏎⏎After.'),
      },
      {
        name: 'takes back the Return at the start of a block',
        doc: 'One.⏎⏎‸Two.',
        keys: ['Enter', 'Backspace'],
        ...plain('One.⏎⏎Two.', 'One.⏎⏎‸Two.'),
      },
    ]),
  );
});

describe('Return in a heading', () => {
  const ledger = '⏎⏎<!-- redlines⏎version: 1⏎marks:⏎  q2hw: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';
  scriptRows(
    both([
      {
        name: 'at the end of the text',
        doc: 'Para.⏎⏎## Head line‸⏎⏎Next.',
        ...plain('Para.⏎⏎## Head line⏎⏎Next.', 'Para.⏎⏎## Head line⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'at the end, a paragraph right under it',
        doc: '## Head‸⏎Para.',
        ...plain('## Head⏎Para.', '## Head⏎⏎‸⏎⏎Para.'),
      },
      {
        name: 'at the end, a paragraph right under it, then text typed',
        doc: '## Head‸⏎Para.',
        keys: ['Enter', { type: 'X' }],
        off: { file: '## Head⏎⏎X⏎⏎Para.' },
        on: { file: '## Head⏎⏎<ins>⏎⏎X</ins>⏎⏎Para.' },
      },
      {
        name: 'in the middle',
        doc: 'Para.⏎⏎## Head ‸line⏎⏎Next.',
        off: { file: 'Para.⏎⏎## Head ⏎⏎## line⏎⏎Next.', caret: 'Para.⏎⏎## Head ⏎⏎## ‸line⏎⏎Next.' },
        on: {
          file: 'Para.⏎⏎## Head <split>⏎⏎## line⏎⏎Next.',
          caret: 'Para.⏎⏎## Head <split>⏎⏎## ‸line⏎⏎Next.',
        },
      },
      {
        name: 'at the start of the text: an empty body paragraph above',
        doc: 'Para.⏎⏎## ‸Head line⏎⏎Next.',
        ...plain('Para.⏎⏎## Head line⏎⏎Next.', 'Para.⏎⏎⏎⏎## ‸Head line⏎⏎Next.'),
      },
      {
        name: "at the start, with another person's pending change to the heading",
        doc: `Para.⏎⏎<!--fmt q2hw was=p-->⏎⏎## ‸Head line<!--/q2hw-->⏎⏎Next.${ledger}`,
        ...plain(
          'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎Next.',
          'Para.⏎⏎⏎⏎<fmt was=p>⏎⏎## ‸Head line</fmt>⏎⏎Next.',
        ),
      },
      {
        name: "at the end, with another person's pending change to the heading (review B+C I2)",
        doc: `Para.⏎⏎<!--fmt q2hw was=p-->⏎⏎## Head line‸<!--/q2hw-->⏎⏎Next.${ledger}`,
        ...plain(
          'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎Next.',
          'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎‸⏎⏎Next.',
        ),
      },
      {
        name: "at the end, with another person's pending change to the heading, then text typed",
        doc: `Para.⏎⏎<!--fmt q2hw was=p-->⏎⏎## Head line‸<!--/q2hw-->⏎⏎Next.${ledger}`,
        keys: ['Enter', { type: 'X' }],
        off: { file: 'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎X⏎⏎Next.' },
        on: { file: 'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎<ins>⏎⏎X</ins>⏎⏎Next.' },
      },
      {
        name: "in the middle, with another person's pending change to the heading",
        doc: `Para.⏎⏎<!--fmt q2hw was=p-->⏎⏎## Head ‸line<!--/q2hw-->⏎⏎Next.${ledger}`,
        off: { file: 'Para.⏎⏎<fmt was=p>⏎⏎## Head ⏎⏎## line</fmt>⏎⏎Next.' },
        on: {
          file: 'Para.⏎⏎<fmt was=p>⏎⏎## Head line</fmt>⏎⏎Next.',
          refusal: "Decide bo's change to this block first.",
        },
        skipOn: { 'take-back': 'The Return is refused, so Backspace has no Return to take back' },
      },
      {
        name: 'at the end of a setext heading',
        doc: 'Head‸⏎===⏎⏎Next.',
        ...plain('Head⏎===⏎⏎Next.', 'Head⏎===⏎⏎‸⏎⏎Next.'),
      },
      {
        name: 'in the middle of a setext heading',
        doc: 'He‸ad⏎===',
        off: { file: 'He⏎===⏎⏎ad⏎===', caret: 'He⏎===⏎⏎‸ad⏎===' },
        on: {},
      },
    ]),
  );
});

describe('Return in a quote', () => {
  scriptRows(
    both([
      {
        name: "at the end of the quote's last paragraph",
        doc: '> One two.‸⏎⏎After.',
        ...plain('> One two.⏎⏎After.', '> One two.⏎>⏎> ‸⏎⏎After.'),
      },
      {
        name: 'at the end, then text typed',
        doc: '> One two.‸⏎⏎After.',
        keys: ['Enter', { type: 'X' }],
        off: { file: '> One two.⏎>⏎> X⏎⏎After.' },
        on: { file: '> One two.⏎>⏎> <ins>⏎>⏎> X</ins>⏎⏎After.' },
      },
      {
        name: 'at the end of a paragraph with another after it',
        doc: '> One.‸⏎>⏎> Two.',
        ...plain('> One.⏎>⏎> Two.', '> One.⏎>⏎> ‸⏎>⏎> Two.'),
      },
      {
        name: 'in the middle',
        doc: '> One ‸two.',
        off: { file: '> One ⏎>⏎> two.', caret: '> One ⏎>⏎> ‸two.' },
        on: { file: '> One <split>⏎>⏎> two.', caret: '> One <split>⏎>⏎> ‸two.' },
      },
      {
        name: 'at the end of a lazy line that the paragraph goes on after',
        doc: '> A long quote that⏎wraps lazily.‸⏎> q',
        off: {
          file: '> A long quote that⏎wraps lazily.⏎>⏎> q',
          caret: '> A long quote that⏎wraps lazily.⏎>⏎> ‸q',
        },
        on: {
          file: '> A long quote that⏎wraps lazily.<split>⏎>⏎> ⏎> q',
          caret: '> A long quote that⏎wraps lazily.<split>⏎>⏎> ⏎> ‸q',
        },
        skipOn: { 'stray-blank-line': TWO_BREAKS },
      },
      {
        name: "at the start of the quote's first paragraph",
        doc: '> ‸One two.',
        off: { file: '> One two.', caret: '> ⏎>⏎> ‸One two.' },
        on: { file: '> One two.', caret: '> <split>⏎>⏎> ‸One two.' },
      },
      {
        name: 'in the empty paragraph at the end of the quote: out of it',
        doc: '> One two.‸⏎⏎After.',
        keys: ['Enter', 'Enter'],
        ...plain('> One two.⏎⏎After.', '> One two.⏎⏎‸⏎⏎After.'),
      },
      {
        name: 'in the empty paragraph at the end of the quote, then text typed',
        doc: '> One two.‸⏎⏎After.',
        keys: ['Enter', 'Enter', { type: 'X' }],
        off: { file: '> One two.⏎⏎X⏎⏎After.' },
        on: { file: '> One two.⏎⏎<ins>⏎⏎X</ins>⏎⏎After.' },
      },
      {
        name: 'in an empty paragraph in the middle of a quote: it parts the quote',
        doc: '> One.‸⏎>⏎> Two.',
        keys: ['Enter', 'Enter'],
        off: { file: '> One.⏎>⏎> Two.', caret: '> One.⏎⏎‸⏎>⏎> Two.' },
        on: { file: '> One.⏎>⏎> Two.' },
      },
      {
        name: 'in an empty paragraph in a quote in a quote: out one level',
        doc: '> > x‸',
        keys: ['Enter', 'Enter'],
        ...plain('> > x', '> > x⏎> >⏎> ‸'),
      },
      {
        name: "at the end of a GitHub alert's first line: into its body",
        doc: '> [!NOTE]‸',
        ...plain('> [!NOTE]', '> [!NOTE]⏎> ‸'),
      },
      {
        name: 'at the end of a heading in a quote',
        doc: '> ## H‸',
        ...plain('> ## H', '> ## H⏎>⏎> ‸'),
      },
    ]),
  );
});

describe('the file around Return', () => {
  const mounted: Editor[] = [];
  afterEach(() => {
    for (const editor of mounted.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function press(editor: Editor, key: string): void {
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      'editor',
    );
  }

  it.each([false, true])(
    'keeps a CRLF file byte for byte through Return and Backspace, Track Changes %s',
    (tracking) => {
      const file = 'One two.\r\n\r\nNext.\r\n';
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc: file,
        author: { handle: 'ada', name: 'Ada Lovelace' },
        tracking,
      });
      mounted.push(editor);
      // At the end: the file never gets the empty paragraph; leaving takes it back.
      editor.view.dispatch({ selection: { anchor: 'One two.'.length } });
      press(editor, 'Enter');
      expect(editor.getDoc()).toBe(file);
      press(editor, 'Backspace');
      expect(editor.getDoc()).toBe(file);
      press(editor, 'Enter');
      editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length - 2 } });
      expect(editor.getDoc()).toBe(file);
      // In the middle: the new line breaks take the file's own, and Backspace takes them back.
      editor.view.dispatch({ selection: { anchor: 'One '.length } });
      press(editor, 'Enter');
      if (!tracking) expect(editor.getDoc()).toBe('One \r\n\r\ntwo.\r\n\r\nNext.\r\n');
      press(editor, 'Backspace');
      expect(editor.getDoc()).toBe(file);
    },
  );
});
