// Debug only: checks block editing in WebKit, where happy-dom can't: the keys through CodeMirror's
// own key handling (synthetic keydown events on the content), typing through
// `document.execCommand('insertText')`, so that WebKit's own editing runs where it matters, and
// the line break inputs as the `beforeinput` events of `insertParagraph` and `insertLineBreak`
// (dictation's "new paragraph" and "new line" are to check by hand); and ↑ and ↓, which need a
// layout. Serve the page with `VITE_BLOCK_CHECK=1 pnpm dev` (or `pnpm tauri dev`, for WKWebView)
// and open it in WebKit: it reads nothing in a release build. Each check loads its document,
// presses its keys in Clean, and reports one console line, `BLOCK-CHECK <name> pass` or
// `BLOCK-CHECK <name> FAIL <json>`, with the file, the caret and the hidden lines it found, then
// `BLOCK-CHECK done <passed> passed, <failed> failed`. Tab and Escape then Tab are judged by what
// the page does with the key event (`BLOCK-CHECK tab`); a triple-click is a synthetic `mousedown`
// with three clicks in its `detail`, aimed at the text's own coordinates; a click on a task box is
// a `mousedown` on its drawing.

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
import sample from './sample.md?raw';

/** A step: a key as CodeMirror names it, typed text, or a line break input. */
type Step =
  | string
  | { type: string }
  | { input: 'insertParagraph' | 'insertLineBreak' }
  /** A command of the editor's registry, as the Paragraph menu runs it. */
  | { command: string }
  /** A triple-click on the text at the caret's start position. */
  | { triple: true }
  /** A click on the drawing of the task box with this index (from 0, in the order drawn). */
  | { click: number }
  /** Space on the task box with this index, focused first: the keyboard's way to change it. */
  | { space: number }
  /** Waits until the line of notices under the title bar is empty. */
  | { quiet: true };

interface Check {
  name: string;
  /** The document, `⏎` for a line break and `‸` for the caret. */
  doc: string;
  steps: Step[];
  tracking?: boolean;
  /** The text after the steps with the caret, in the same notation (Track Changes off). */
  caret?: string;
  /** The file, as `getDoc` gives it (Track Changes off). */
  file?: string;
  /** A selection made after the load: from the start of the first text to the end of the second. */
  select?: [string, string];
  /** The newest view of the file (Track Changes on). */
  newest?: string;
  /** The text the selection holds after the steps. */
  selected?: string;
  /** Whether an empty paragraph is open after the steps. */
  open?: boolean;
  /** A test of its own on the view after the steps, instead of the text. */
  test?: (editor: Editor, start: { head: number }) => unknown;
}

const lf = (text: string) => text.replaceAll('⏎', '\n');
const notation = (text: string) => text.replaceAll('\n', '⏎');

/** The line of `pos`, 1-based. */
const lineOf = (editor: Editor, pos: number) => editor.view.state.doc.lineAt(pos).number;

/** The ids of eight pending inline changes (a word inserted, deleted or replaced, inside an item's
 * text), and a list that has them in its items after "one" and "two", with the ledger that goes
 * with them: Tab in a list under review (format §2.6, rule 6). */
const PENDING = ['kbx9', 'kcx9', 'kdx9', 'kfx9', 'kgx9', 'khx9', 'kjx9', 'kkx9'];
const PENDING_ITEMS = PENDING.map((id, i) =>
  i % 3 === 0
    ? `- item ${i} <!--ins ${id}-->new <!--/${id}-->words`
    : i % 3 === 1
      ? `- item ${i} <!--del ${id} big -->words`
      : `- item ${i} <!--sub ${id} old-->fresh<!--/${id}--> words`,
);
const PENDING_FILE = [
  '- one',
  '- ‸two',
  ...PENDING_ITEMS,
  '',
  '<!-- redlines',
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  'marks:',
  ...PENDING.map((id) => `  ${id}: {by: bo, at: 2026-10-13T22:30Z}`),
  '-->',
].join('⏎');

/** The drawings of the task boxes, in the order drawn. */
const boxesOf = (editor: Editor) => [...editor.view.contentDOM.querySelectorAll('.rl-box')];

/** What the line of notices under the title bar says now, or null while it is empty. */
const notice = () => {
  const line = document.querySelector<HTMLElement>('.rl-notice');
  return line && !line.hidden ? (line.textContent ?? '') : null;
};

/** The left edge of the drawing of a task box, or null without one. */
const boxLeft = (editor: Editor, index: number) =>
  boxesOf(editor)[index]?.getBoundingClientRect().left ?? null;

/** The fill of a box's square, as WebKit resolves it. */
const boxFill = (editor: Editor, index: number) => {
  const rect = boxesOf(editor)[index]?.querySelector('rect');
  return rect ? getComputedStyle(rect).fill : null;
};

/** The newest view of the file, in the notation, without the line breaks that end it. */
const newestText = (editor: Editor) =>
  notation(newestView(editor.getDoc()).text).replace(/⏎+$/, '');

/** A task list with eight pending changes inside the items after "one" and "two" (rule 6). */
const PENDING_TASK_FILE = PENDING_FILE.replace('- one', '- [ ] one')
  .replace('- ‸two', '- [ ] ‸two')
  .replaceAll('⏎- item', '⏎- [ ] item');

const CHECKS: Check[] = [
  {
    name: 'return-at-end',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Enter'],
    caret: 'One two.⏎⏎‸⏎⏎Next.',
    file: 'One two.⏎⏎Next.',
    open: true,
  },
  {
    name: 'return-then-typing',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Enter', { type: 'New' }],
    file: 'One two.⏎⏎New⏎⏎Next.',
    open: false,
  },
  {
    name: 'return-then-backspace',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Enter', 'Backspace'],
    caret: 'One two.‸⏎⏎Next.',
    open: false,
  },
  { name: 'return-in-middle', doc: 'One ‸two.', steps: ['Enter'], caret: 'One ⏎⏎‸two.' },
  {
    name: 'return-at-start',
    doc: 'One.⏎⏎‸Two.',
    steps: ['Enter'],
    caret: 'One.⏎⏎⏎⏎‸Two.',
    open: true,
  },
  {
    name: 'return-in-list',
    doc: '- one‸',
    steps: ['Enter', { type: 'two' }],
    file: '- one⏎- two',
  },
  {
    name: 'ladder-first-press',
    doc: '- one⏎- ‸two',
    steps: ['Backspace'],
    caret: '- one\\⏎  ‸two',
  },
  {
    name: 'ladder-second-press',
    doc: '- one⏎- ‸two',
    steps: ['Backspace', 'Backspace'],
    caret: '- one‸two',
  },
  { name: 'backspace-join', doc: 'One.⏎⏎‸Two.', steps: ['Backspace'], caret: 'One.‸Two.' },
  { name: 'delete-join', doc: 'One.‸⏎⏎Two.', steps: ['Delete'], caret: 'One.‸Two.' },
  { name: 'shift-return', doc: 'One ‸two.', steps: ['Shift-Enter'], caret: 'One \\⏎‸two.' },
  {
    name: 'arrow-left-over-heading',
    doc: 'One.⏎⏎## ‸Two',
    steps: ['ArrowLeft'],
    caret: 'One.‸⏎⏎## Two',
  },
  {
    name: 'arrow-right-into-heading',
    doc: 'One.‸⏎⏎## Two',
    steps: ['ArrowRight'],
    caret: 'One.⏎⏎## ‸Two',
  },
  {
    name: 'arrow-up-over-hidden-line',
    doc: 'One two three.⏎⏎Fo‸ur five.',
    steps: ['ArrowUp'],
    test: (editor) => {
      const { head } = editor.view.state.selection.main;
      return lineOf(editor, head) === 1 ? null : { line: lineOf(editor, head), head };
    },
  },
  {
    name: 'arrow-down-over-hidden-line',
    doc: 'One t‸wo three.⏎⏎Four five.',
    steps: ['ArrowDown'],
    test: (editor) => {
      const { head } = editor.view.state.selection.main;
      return lineOf(editor, head) === 3 ? null : { line: lineOf(editor, head), head };
    },
  },
  {
    name: 'arrow-down-past-table',
    doc: 'Ab‸ove.⏎⏎| a | b |⏎| - | - |⏎| 1 | 2 |⏎⏎Below.',
    steps: ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'],
    test: (editor) => {
      // Never on a hidden line on the way: the hidden-line check below says so; here, it gets
      // past the table to the paragraph below.
      const { head } = editor.view.state.selection.main;
      return lineOf(editor, head) === 7 ? null : { line: lineOf(editor, head), head };
    },
  },
  {
    name: 'insert-paragraph-input',
    doc: 'One ‸two.',
    steps: [{ input: 'insertParagraph' }],
    caret: 'One ⏎⏎‸two.',
  },
  {
    name: 'insert-line-break-input',
    doc: 'One ‸two.',
    steps: [{ input: 'insertLineBreak' }],
    caret: 'One \\⏎‸two.',
  },
  {
    name: 'tracked-return-then-typing',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Enter', { type: 'New' }],
    tracking: true,
    newest: 'One two.⏎⏎New⏎⏎Next.',
  },
  {
    name: 'tracked-split-and-take-back',
    doc: 'One ‸two.',
    steps: ['Enter', 'Backspace'],
    tracking: true,
    file: 'One two.',
  },
  {
    name: 'tab-indents-item',
    doc: '- one⏎- ‸two',
    steps: ['Tab'],
    caret: '- one⏎  - ‸two',
    file: '- one⏎  - two',
  },
  {
    name: 'tab-in-the-middle-of-item-text',
    doc: '- one⏎- t‸wo',
    steps: ['Tab'],
    caret: '- one⏎  - t‸wo',
    file: '- one⏎  - two',
  },
  {
    name: 'shift-tab-outdents-item',
    doc: '- one⏎  - ‸two',
    steps: ['Shift-Tab'],
    caret: '- one⏎- ‸two',
    file: '- one⏎- two',
  },
  {
    // Eight pending changes in the list's other items, after their first character, are apart from
    // the change (rule 6): Tab works, and every one of them is still pending.
    name: 'tracked-tab-in-a-list-with-eight-pending-changes',
    doc: PENDING_FILE,
    steps: ['Tab'],
    tracking: true,
    test: (editor) => {
      const file = editor.getDoc();
      const left = PENDING.filter((id) => !new RegExp(`<!--(?:ins|del|sub) ${id}[ -]`).test(file));
      if (left.length > 0 || !file.includes('was=indent=0')) {
        return { decided: left, indented: file.includes('was=indent=0') };
      }
      return null;
    },
  },
  {
    name: 'tab-numbered-item-from-1',
    doc: '2. two⏎3. ‸three',
    steps: ['Tab'],
    file: '2. two⏎   1. three',
  },
  {
    name: 'tab-in-first-item-changes-nothing',
    doc: '- ‸one⏎- two',
    steps: ['Tab'],
    file: '- one⏎- two',
  },
  {
    name: 'tab-in-paragraph-changes-nothing',
    doc: 'One t‸wo.',
    steps: ['Tab'],
    file: 'One two.',
  },
  {
    name: 'tab-on-item-after-return',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab', { type: 'x' }],
    file: '- one⏎- two⏎  - x',
  },
  {
    name: 'tracked-tab-indents-item',
    doc: '- one⏎- ‸two',
    steps: ['Tab'],
    tracking: true,
    newest: '- one⏎  - two',
    test: (editor) =>
      editor.getDoc().includes('was=indent=0') ? null : { noMark: notation(editor.getDoc()) },
  },
  {
    name: 'tracked-shift-tab-outdents-item',
    doc: '- one⏎  - ‸two',
    steps: ['Shift-Tab'],
    tracking: true,
    newest: '- one⏎- two',
    test: (editor) =>
      editor.getDoc().includes('was=indent=2') ? null : { noMark: notation(editor.getDoc()) },
  },
  {
    name: 'tracked-tab-on-item-after-return',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab', { type: 'x' }],
    tracking: true,
    newest: '- one⏎- two⏎  - x',
    // The item is the break's own: no mark of its own beside the split.
    test: (editor) =>
      editor.getDoc().includes('was=indent') ? { fmt: notation(editor.getDoc()) } : null,
  },
  {
    name: 'tab-after-return-opens-item-not-in-file',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab'],
    caret: '- one⏎- two⏎  - ‸',
    file: '- one⏎- two',
    open: true,
  },
  {
    name: 'tab-after-return-then-leaving-takes-it-back',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab', 'ArrowUp'],
    file: '- one⏎- two',
    open: false,
    test: (editor) =>
      editor.view.state.doc.toString() === '- one\n- two'
        ? null
        : { live: editor.view.state.doc.toString() },
  },
  {
    name: 'tab-after-return-then-shift-tab-is-an-ordinary-item',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab', 'Shift-Tab'],
    caret: '- one⏎- two⏎- ‸',
    file: '- one⏎- two⏎- ',
    open: false,
  },
  {
    name: 'tracked-tab-after-return-opens-item-not-in-file',
    doc: '- one⏎- two‸',
    steps: ['Enter', 'Tab'],
    tracking: true,
    file: '- one⏎- two',
    open: true,
  },
  {
    name: 'tab-on-empty-item-of-the-file-is-refused',
    doc: '- one⏎- two⏎- ‸',
    steps: ['Tab'],
    file: '- one⏎- two⏎- ',
    open: false,
  },
  {
    name: 'option-up-to-start-of-paragraph',
    doc: 'One.⏎⏎Tw‸o three.',
    steps: ['Alt-ArrowUp'],
    caret: 'One.⏎⏎‸Two three.',
    file: 'One.⏎⏎Two three.',
  },
  {
    name: 'option-up-from-start-to-paragraph-before',
    doc: 'One.⏎⏎‸Two three.',
    steps: ['Alt-ArrowUp'],
    caret: '‸One.⏎⏎Two three.',
    file: 'One.⏎⏎Two three.',
  },
  {
    name: 'option-down-to-end-of-paragraph',
    doc: 'On‸e.⏎⏎Two three.',
    steps: ['Alt-ArrowDown'],
    caret: 'One.‸⏎⏎Two three.',
    file: 'One.⏎⏎Two three.',
  },
  {
    name: 'option-down-from-end-to-next-end',
    doc: 'One.‸⏎⏎Two three.',
    steps: ['Alt-ArrowDown'],
    caret: 'One.⏎⏎Two three.‸',
    file: 'One.⏎⏎Two three.',
  },
  {
    name: 'option-down-in-list-never-moves-the-line',
    doc: '- o‸ne⏎- two',
    steps: ['Alt-ArrowDown'],
    caret: '- one‸⏎- two',
    file: '- one⏎- two',
  },
  {
    name: 'shift-option-up-selects-to-paragraph-start',
    doc: 'One.⏎⏎Tw‸o three.',
    steps: ['Shift-Alt-ArrowUp'],
    selected: 'Tw',
  },
  {
    name: 'triple-click-selects-block-text-not-break',
    doc: 'One.⏎⏎Tw‸o three.⏎⏎Four.',
    steps: [{ triple: true }],
    selected: 'Two three.',
  },
  {
    name: 'triple-click-then-typing-keeps-break',
    doc: 'One.⏎⏎Tw‸o three.⏎⏎Four.',
    steps: [{ triple: true }, { type: 'X' }],
    file: 'One.⏎⏎X⏎⏎Four.',
  },
  // Stage 4: the empty line Shift-Return opens, hard breaks drawn, typed syntax, and the Paragraph
  // menu on an empty paragraph. Each fails unless the behavior really happened.
  {
    name: 'shift-return-opens-an-empty-line',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter'],
    caret: 'One two.\\⏎‸\u00a0⏎⏎Next.',
    file: 'One two.⏎⏎Next.',
    open: true,
  },
  {
    // The Return that confirms nothing else: the line is drawn, with the caret on it.
    name: 'shift-return-empty-line-is-drawn-with-the-caret',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter'],
    test: (editor) => {
      const { head } = editor.view.state.selection.main;
      const box = editor.view.coordsAtPos(head);
      const above = editor.view.coordsAtPos(editor.view.state.doc.lineAt(head).from - 3);
      return box && above && box.top > above.top ? null : { box, above };
    },
  },
  {
    name: 'shift-return-empty-line-typing-replaces-the-space',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter', { type: 'X' }],
    file: 'One two.\\⏎X⏎⏎Next.',
    caret: 'One two.\\⏎X‸⏎⏎Next.',
    open: false,
  },
  {
    name: 'shift-return-empty-line-leaving-takes-it-back',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter', 'ArrowUp'],
    open: false,
    test: (editor) =>
      editor.view.state.doc.toString() === 'One two.\n\nNext.'
        ? null
        : { live: notation(editor.view.state.doc.toString()) },
  },
  {
    name: 'shift-return-empty-line-then-return-opens-a-paragraph',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter', 'Enter'],
    caret: 'One two.⏎⏎‸⏎⏎Next.',
    open: true,
  },
  {
    name: 'shift-return-empty-line-then-backspace-takes-it-back',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter', 'Backspace'],
    caret: 'One two.‸⏎⏎Next.',
    open: false,
  },
  {
    // Track Changes on: the split is held with the view, in Clean, until the first character.
    name: 'tracked-shift-return-empty-line-holds-the-view-until-typed',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter'],
    tracking: true,
    open: true,
    test: (editor) =>
      editor.getUiState().view === 'clean' ? null : { view: editor.getUiState().view },
  },
  {
    name: 'tracked-shift-return-empty-line-typing-switches-the-view',
    doc: 'One two.‸⏎⏎Next.',
    steps: ['Shift-Enter', { type: 'X' }],
    tracking: true,
    newest: 'One two.\\⏎X⏎⏎Next.',
    test: (editor) => (editor.getUiState().view === 'clean' ? { view: 'still clean' } : null),
  },
  {
    name: 'hard-break-is-stepped-over-going-right',
    doc: 'One‸\\⏎two.',
    steps: ['ArrowRight'],
    caret: 'One\\⏎‸two.',
  },
  {
    name: 'hard-break-is-stepped-over-going-left',
    doc: 'One\\⏎‸two.',
    steps: ['ArrowLeft'],
    caret: 'One‸\\⏎two.',
  },
  {
    name: 'hard-break-spaces-are-stepped-over',
    doc: 'One‸  ⏎two.',
    steps: ['ArrowRight'],
    caret: 'One  ⏎‸two.',
  },
  {
    name: 'hard-break-backslash-is-not-drawn',
    doc: 'One\\⏎‸two.',
    steps: [],
    test: (editor) => {
      const first = editor.view.contentDOM.querySelector('.cm-line');
      return first && !first.textContent?.includes('\\') ? null : { drawn: first?.textContent };
    },
  },
  {
    name: 'hard-break-backspace-takes-it-as-one-character',
    doc: 'One\\⏎‸two.',
    steps: ['Backspace'],
    file: 'Onetwo.',
  },
  {
    name: 'typed-hash-is-drawn-as-body',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '#' }],
    test: (editor) => {
      const heading = editor.view.contentDOM.querySelector('.rl-h1');
      return heading ? { drawnAsHeading: heading.textContent } : null;
    },
  },
  {
    name: 'typed-hash-and-space-is-a-heading',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '#' }, { type: ' ' }],
    file: 'One.⏎⏎# ⏎⏎Next.',
    test: (editor) => (editor.view.contentDOM.querySelector('.rl-h1') ? null : { noHeading: true }),
  },
  {
    name: 'typed-dash-is-drawn-as-body',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '-' }],
    test: (editor) => {
      const bullet = editor.view.contentDOM.querySelector('.rl-list-mark, .rl-li');
      return bullet ? { drawnAsItem: bullet.textContent } : null;
    },
  },
  {
    name: 'typed-dash-and-space-is-an-item',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '-' }, { type: ' ' }],
    file: 'One.⏎⏎- ⏎⏎Next.',
    test: (editor) => (editor.view.contentDOM.querySelector('.rl-li') ? null : { noItem: true }),
  },
  {
    name: 'typed-quote-stays-when-the-caret-leaves',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '>' }, 'ArrowUp'],
    file: 'One.⏎⏎>⏎⏎Next.',
  },
  {
    name: 'typed-backticks-close-the-fence',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '`' }, { type: '`' }, { type: '`' }],
    file: 'One.⏎⏎```⏎⏎```⏎⏎Next.',
    caret: 'One.⏎⏎```‸⏎⏎```⏎⏎Next.',
  },
  {
    name: 'typed-rule-and-return-opens-a-paragraph-after-it',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '-' }, { type: '-' }, { type: '-' }, 'Enter'],
    caret: 'One.⏎⏎---⏎⏎‸⏎⏎Next.',
    open: true,
  },
  {
    name: 'typed-table-row-and-return-writes-the-delimiter-row',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { type: '| a | b |' }, 'Enter'],
    file: 'One.⏎⏎| a | b |⏎| --- | --- |⏎|  |  |⏎⏎Next.',
  },
  {
    name: 'paragraph-menu-heading-on-an-empty-paragraph',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.h2' }],
    caret: 'One.⏎⏎## ‸⏎⏎Next.',
    file: 'One.⏎⏎## ⏎⏎Next.',
    test: (editor) => (editor.view.contentDOM.querySelector('.rl-h2') ? null : { noHeading: true }),
  },
  {
    name: 'paragraph-menu-bulleted-list-on-an-empty-paragraph',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.ul' }],
    caret: 'One.⏎⏎- ‸⏎⏎Next.',
  },
  {
    name: 'paragraph-menu-quote-on-an-empty-paragraph-stays',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.quote' }, 'ArrowUp'],
    file: 'One.⏎⏎> ⏎⏎Next.',
  },
  {
    name: 'paragraph-menu-body-on-an-empty-paragraph-does-nothing',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.body' }],
    caret: 'One.⏎⏎‸⏎⏎Next.',
    open: true,
  },
  {
    name: 'paragraph-menu-rule-on-an-empty-paragraph',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.rule' }],
    file: 'One.⏎⏎---⏎⏎Next.',
  },
  {
    name: 'tracked-paragraph-menu-heading-on-an-empty-paragraph',
    doc: 'One.‸⏎⏎Next.',
    steps: ['Enter', { command: 'block.h2' }],
    tracking: true,
    newest: 'One.⏎⏎## ⏎⏎Next.',
  },
  // Stage 5: the task box, its pending state, the empty task item and Paragraph › Check Item.
  // Each row loads its own document, and fails unless the behavior really happened.
  {
    name: 'box-click-checks-the-box',
    doc: '- [ ] one⏎- [x] two⏎⏎End.‸',
    steps: [{ click: 0 }],
    file: '- [x] one⏎- [x] two⏎⏎End.',
    test: (editor) =>
      boxesOf(editor)
        .map((box) => box.getAttribute('aria-checked'))
        .join() === 'true,true'
        ? null
        : { boxes: boxesOf(editor).length },
  },
  {
    name: 'box-click-unchecks-the-box',
    doc: '- [ ] one⏎- [x] two⏎⏎End.‸',
    steps: [{ click: 1 }],
    file: '- [ ] one⏎- [ ] two⏎⏎End.',
  },
  {
    // The box is reached by the keyboard, has a name, and Space changes it as a click does.
    name: 'box-space-checks-the-box-and-the-box-has-a-name',
    doc: '- [ ] one⏎- [x] two‸',
    steps: [{ space: 0 }],
    file: '- [x] one⏎- [x] two',
    test: (editor) => {
      const [first, second] = boxesOf(editor);
      return first?.getAttribute('aria-label') === 'Done' &&
        second?.getAttribute('aria-label') === 'Done' &&
        first.getAttribute('tabindex') === '0'
        ? null
        : { first: first?.getAttribute('aria-label'), second: second?.getAttribute('aria-label') };
    },
  },
  {
    name: 'tracked-box-space-names-the-pending-change',
    doc: '- [ ] one⏎- [x] two‸',
    steps: [{ space: 0 }],
    tracking: true,
    test: (editor) => {
      const label = boxesOf(editor)[0]?.getAttribute('aria-label');
      return /^Done, checked by .+, pending$/.test(label ?? '') ? null : { label };
    },
  },
  {
    name: 'tracked-box-click-is-a-box-change',
    doc: '- [ ] one⏎- [x] two⏎⏎End.‸',
    steps: [{ click: 0 }],
    tracking: true,
    newest: '- [x] one⏎- [x] two⏎⏎End.',
    test: (editor) =>
      /^- \[x\] one<!--fmt \w+ \+check-->⏎- \[x\] two⏎/.test(notation(editor.getDoc()))
        ? null
        : { file: notation(editor.getDoc()) },
  },
  {
    name: 'tracked-box-click-twice-gives-the-file-back',
    doc: '- [ ] one⏎- [x] two⏎⏎End.‸',
    steps: [{ click: 0 }, { click: 0 }],
    tracking: true,
    file: '- [ ] one⏎- [x] two⏎⏎End.',
  },
  {
    // A box behind a `>` is checked like any other, at both depths, by a click and by Space (#274).
    name: 'tracked-box-in-a-quote-click-is-a-box-change',
    doc: '> - [ ] one⏎> - [x] two⏎⏎End.‸',
    steps: [{ click: 0 }],
    tracking: true,
    newest: '> - [x] one⏎> - [x] two⏎⏎End.',
    test: (editor) =>
      /^> - \[x\] one<!--fmt \w+ \+check-->⏎> - \[x\] two⏎/.test(notation(editor.getDoc())) &&
      notice() === null
        ? null
        : { file: notation(editor.getDoc()), notice: notice() },
  },
  {
    name: 'tracked-box-in-a-quote-space-is-a-box-change',
    doc: '> - [ ] one⏎> - [x] two‸',
    steps: [{ space: 0 }],
    tracking: true,
    newest: '> - [x] one⏎> - [x] two',
    test: (editor) =>
      /^> - \[x\] one<!--fmt \w+ \+check-->⏎/.test(notation(editor.getDoc())) && notice() === null
        ? null
        : { file: notation(editor.getDoc()), notice: notice() },
  },
  {
    name: 'tracked-box-in-a-quote-at-depth-two-click-is-a-box-change',
    doc: '> > - [ ] one⏎> > - [x] two⏎⏎End.‸',
    steps: [{ click: 0 }],
    tracking: true,
    newest: '> > - [x] one⏎> > - [x] two⏎⏎End.',
  },
  {
    // The box is drawn in its new state in its author's color, with the line's change bar: its
    // fill is not the gray of the checked box beside it, and the other lines have no bar.
    name: 'tracked-box-click-draws-the-pending-box',
    doc: '- [ ] one⏎- [x] two⏎⏎End.‸',
    steps: [{ click: 0 }],
    tracking: true,
    test: (editor) => {
      const [pending, plain] = boxesOf(editor);
      const lines = [...editor.view.contentDOM.querySelectorAll('.cm-line')];
      const problems: Record<string, unknown> = {};
      if (pending?.getAttribute('aria-checked') !== 'true') problems['checked'] = false;
      if (!pending?.parentElement?.classList.contains('rl-box-pending'))
        problems['pending'] = false;
      if (boxFill(editor, 0) === boxFill(editor, 1)) problems['fill'] = boxFill(editor, 0);
      if (!lines[0]?.classList.contains('rl-bar')) problems['bar'] = false;
      if (lines[1]?.classList.contains('rl-bar')) problems['barBelow'] = true;
      if (plain?.parentElement?.classList.contains('rl-box-pending')) problems['plain'] = true;
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // 0.8 em square, centred on the x-height: as tall as 0.8 of the text's size, and its middle
    // within a pixel of the middle of a lowercase letter in the same line.
    name: 'box-is-a-small-square-on-the-x-height',
    doc: '- [ ] xxxx‸',
    steps: [],
    test: (editor) => {
      const box = boxesOf(editor)[0];
      if (!box) return { noBox: true };
      const size = parseFloat(getComputedStyle(box.closest('.cm-line') ?? box).fontSize);
      const at = box.getBoundingClientRect();
      const line = box.closest('.cm-line');
      const text = line && document.createRange();
      if (!line || !text) return { noLine: true };
      text.selectNodeContents(line.lastChild ?? line);
      const letters = text.getBoundingClientRect();
      const squareness = Math.abs(at.width - at.height);
      const ratio = at.height / size;
      const xHeightMiddle = (at.top + at.bottom) / 2 - (letters.top + letters.bottom) / 2;
      return squareness < 0.5 &&
        Math.abs(ratio - 0.8) < 0.05 &&
        Math.abs(xHeightMiddle) < size * 0.3
        ? null
        : { width: at.width, height: at.height, size, xHeightMiddle };
    },
  },
  {
    // The caret inside the marker shows the box's source (the second item only: the first is still
    // drawn), and the item's text stays in its column when the source goes back to a box.
    name: 'box-source-shows-while-the-caret-touches-the-marker',
    doc: '- [ ] one⏎- [‸x] two',
    steps: [],
    test: (editor) => {
      const { view } = editor;
      const two = view.state.doc.toString().indexOf('two');
      const shown = view.contentDOM.textContent?.includes('[x]');
      const shownBoxes = boxesOf(editor).length;
      const before = view.coordsAtPos(two)?.left ?? null;
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      const after = view.coordsAtPos(two)?.left ?? null;
      const drawn = boxesOf(editor).length;
      const moved = before === null || after === null ? null : Math.abs(before - after);
      return shown && shownBoxes === 1 && drawn === 2 && moved !== null && moved < 2
        ? null
        : { shown, shownBoxes, drawn, before, after };
    },
  },
  {
    // An item Return leaves is an empty box at its indent, the same as the one above it, and no
    // `[ ]` shows as text. Clicking it says to write the item first and changes nothing.
    name: 'empty-task-item-is-an-empty-box-at-the-indent',
    doc: '- [ ] one‸',
    steps: ['Enter', { quiet: true }, { click: 1 }],
    file: '- [ ] one⏎- [ ] ',
    test: (editor) => {
      const first = boxLeft(editor, 0);
      const second = boxLeft(editor, 1);
      const text = editor.view.contentDOM.textContent ?? '';
      const problems: Record<string, unknown> = {};
      if (boxesOf(editor).length !== 2) problems['boxes'] = boxesOf(editor).length;
      if (first === null || second === null || Math.abs(first - second) > 1) {
        problems['left'] = { first, second };
      }
      if (text.includes('[ ]') || text.includes('•')) problems['text'] = text;
      if (boxesOf(editor)[1]?.getAttribute('aria-checked') !== 'false') problems['checked'] = true;
      if (notice() !== 'Write the item first.') problems['notice'] = notice();
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    // Return then Tab: the empty task item is nested, and drawn as an empty box one level in. Its
    // box is text Markdown holds, so it is in the file (it is not an open empty item).
    name: 'nested-empty-task-item-is-an-empty-box-one-level-in',
    doc: '- [ ] one‸',
    steps: ['Enter', 'Tab'],
    file: '- [ ] one⏎  - [ ] ',
    test: (editor) => {
      const first = boxLeft(editor, 0);
      const second = boxLeft(editor, 1);
      const text = editor.view.contentDOM.textContent ?? '';
      return boxesOf(editor).length === 2 &&
        first !== null &&
        second !== null &&
        second > first + 4 &&
        !text.includes('[ ]')
        ? null
        : { boxes: boxesOf(editor).length, first, second, text };
    },
  },
  {
    name: 'tracked-empty-task-item-click-changes-nothing',
    doc: '- [ ] one‸',
    steps: ['Enter', { quiet: true }, { click: 1 }],
    tracking: true,
    test: (editor) =>
      notice() === 'Write the item first.' && !editor.getDoc().includes('+check')
        ? null
        : { notice: notice(), file: notation(editor.getDoc()) },
  },
  // The empty task item under the keys. Each row loads its own document.
  {
    // One Backspace takes the box and the bullet of the empty item together; the next takes a letter.
    name: 'empty-task-item-backspace-takes-the-item',
    doc: '- [ ] one⏎- [ ] ‸',
    steps: ['Backspace'],
    file: '- [ ] one',
    test: (editor) => (boxesOf(editor).length === 1 ? null : { boxes: boxesOf(editor).length }),
  },
  {
    name: 'empty-task-item-second-backspace-takes-a-letter',
    doc: '- [ ] one⏎- [ ] ‸',
    steps: ['Backspace', 'Backspace'],
    file: '- [ ] on',
  },
  {
    name: 'tracked-empty-task-item-backspace-is-a-change-and-leaves-one-box',
    doc: '- [ ] one⏎- [ ] ‸',
    steps: ['Backspace'],
    tracking: true,
    test: (editor) =>
      newestText(editor).trimEnd() === '- [ ] one' &&
      boxesOf(editor).length === 1 &&
      /<!--sub \w+ /.test(editor.getDoc())
        ? null
        : { newest: newestText(editor), boxes: boxesOf(editor).length },
  },
  {
    // A second Return leaves the checklist: an empty paragraph is open, the file keeps the item.
    name: 'empty-task-item-second-return-leaves-the-checklist',
    doc: '- [ ] one‸⏎⏎End.',
    steps: ['Enter', 'Enter'],
    file: '- [ ] one⏎- [ ] ⏎⏎End.',
    open: true,
    test: (editor) => (boxesOf(editor).length === 1 ? null : { boxes: boxesOf(editor).length }),
  },
  {
    name: 'tracked-empty-task-item-second-return-leaves-the-checklist',
    doc: '- [ ] one‸⏎⏎End.',
    steps: ['Enter', 'Enter'],
    tracking: true,
    open: true,
    test: (editor) =>
      newestText(editor) === '- [ ] one⏎- [ ] ⏎⏎End.' && boxesOf(editor).length === 1
        ? null
        : { newest: newestText(editor), boxes: boxesOf(editor).length },
  },
  {
    // The open empty item of Stage 2, in a checklist: the file has no item for it, the box above is
    // still drawn.
    name: 'open-empty-item-in-a-checklist-is-left-out-of-the-file',
    doc: '- [ ] one⏎- two‸',
    steps: ['Enter', 'Tab'],
    file: '- [ ] one⏎- two',
    open: true,
    test: (editor) => (boxesOf(editor).length === 1 ? null : { boxes: boxesOf(editor).length }),
  },
  {
    name: 'tracked-open-empty-item-in-a-checklist-is-left-out-of-the-file',
    doc: '- [ ] one⏎- two‸',
    steps: ['Enter', 'Tab'],
    tracking: true,
    open: true,
    test: (editor) =>
      newestText(editor) === '- [ ] one⏎- two' && boxesOf(editor).length === 1
        ? null
        : { newest: newestText(editor), boxes: boxesOf(editor).length },
  },
  {
    name: 'tracked-empty-task-item-return-and-tab-is-a-nested-empty-box',
    doc: '- [ ] one‸',
    steps: ['Enter', 'Tab'],
    tracking: true,
    open: false,
    test: (editor) => {
      const first = boxLeft(editor, 0);
      const second = boxLeft(editor, 1);
      const text = editor.view.contentDOM.textContent ?? '';
      return newestText(editor) === '- [ ] one⏎  - [ ] ' &&
        boxesOf(editor).length === 2 &&
        first !== null &&
        second !== null &&
        second > first + 4 &&
        !text.includes('[ ]')
        ? null
        : { newest: newestText(editor), boxes: boxesOf(editor).length, first, second, text };
    },
  },
  {
    name: 'check-item-checks-the-item-at-the-caret',
    doc: '- [ ] one⏎- [ ] t‸wo⏎- [ ] three',
    steps: ['Mod-Shift-u'],
    file: '- [ ] one⏎- [x] two⏎- [ ] three',
  },
  {
    name: 'check-item-over-several-items-checks-them-all',
    doc: '- [x] one⏎- [ ] two⏎- [ ] three⏎- plain⏎⏎End.‸',
    select: ['one', 'plain'],
    steps: ['Mod-Shift-u'],
    file: '- [x] one⏎- [x] two⏎- [x] three⏎- plain⏎⏎End.',
  },
  {
    name: 'check-item-over-checked-items-unchecks-them',
    doc: '- [x] one⏎- [x] two⏎- [x] three‸',
    select: ['one', 'three'],
    steps: ['Mod-Shift-u'],
    file: '- [ ] one⏎- [ ] two⏎- [ ] three',
  },
  {
    name: 'tracked-check-item-over-several-items-is-a-box-change-on-each',
    doc: '- [x] one⏎- [ ] two⏎- [ ] three⏎- plain⏎⏎End.‸',
    select: ['one', 'plain'],
    steps: ['Mod-Shift-u'],
    tracking: true,
    newest: '- [x] one⏎- [x] two⏎- [x] three⏎- plain⏎⏎End.',
    test: (editor) => {
      const file = editor.getDoc();
      const marks = file.match(/<!--fmt \w+ \+check-->/g)?.length;
      const bars = [...editor.view.contentDOM.querySelectorAll('.cm-line.rl-bar')].length;
      return marks === 2 && bars === 2 ? null : { marks, bars, file: notation(file) };
    },
  },
  {
    name: 'check-item-is-one-step-to-undo',
    doc: '- [ ] one⏎- [ ] two⏎- [ ] three‸',
    select: ['one', 'three'],
    steps: ['Mod-Shift-u', 'Mod-z'],
    file: '- [ ] one⏎- [ ] two⏎- [ ] three',
  },
  {
    name: 'tracked-check-item-in-a-list-with-eight-pending-changes',
    doc: PENDING_TASK_FILE,
    steps: ['Mod-Shift-u'],
    tracking: true,
    test: (editor) => {
      const file = editor.getDoc();
      const left = PENDING.filter((id) => !new RegExp(`<!--(?:ins|del|sub) ${id}[ -]`).test(file));
      const checked = /- \[x\] ?two<!--fmt \w+ \+check-->/.test(file);
      return left.length === 0 && checked ? null : { decided: left, checked };
    },
  },
  {
    name: 'check-item-on-a-plain-item-says-so',
    doc: '- [ ] one⏎- pl‸ain',
    steps: [{ quiet: true }, 'Mod-Shift-u'],
    file: '- [ ] one⏎- plain',
    test: () =>
      notice()?.startsWith('Check Item works on a task list item') ? null : { notice: notice() },
  },
  {
    name: 'check-item-does-nothing-in-a-table-cell',
    doc: '| a | b |⏎| - | - |⏎| [ ‸] | 2 |',
    steps: ['Mod-Shift-u'],
    file: '| a | b |⏎| - | - |⏎| [ ] | 2 |',
  },
  // #248: keys that were refused with Track Changes on.
  {
    name: 'tracked-delete-at-the-end-of-a-list-before-a-numbered-list',
    doc: '- b‸⏎⏎3. c',
    steps: ['Delete'],
    tracking: true,
    newest: '- bc',
  },
  {
    name: 'tracked-backspace-first-item-at-the-start-of-the-file',
    doc: '- ‸one⏎- two',
    steps: ['Backspace'],
    tracking: true,
    newest: 'one⏎- two',
  },
  {
    name: 'tracked-backspace-first-paragraph-of-a-quote-at-the-start-of-the-file',
    doc: '> ‸One.⏎>⏎> Two.',
    steps: ['Backspace'],
    tracking: true,
    newest: 'One.⏎>⏎> Two.',
  },
  {
    name: 'tracked-return-in-the-empty-first-item-at-the-start-of-the-file',
    doc: '- ‸⏎- two',
    steps: ['Enter', { type: 'x' }],
    tracking: true,
    newest: 'x⏎⏎- two',
  },
  {
    name: 'tracked-return-at-the-start-of-a-nested-first-item-under-text',
    doc: '- One⏎  Beta⏎  + ‸delta',
    steps: ['Enter'],
    tracking: true,
    newest: '- One⏎  Beta⏎⏎  + ⏎  + delta',
  },
  {
    // The caret is in front of the marker of a pending deletion at the end of the line.
    name: 'tracked-shift-return-in-front-of-a-pending-deletion-at-the-end-of-a-line',
    doc: [
      'one alph‸<!--del kbx9 a-->',
      'x café',
      '',
      '<!-- redlines',
      "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.",
      'version: 1',
      'people:',
      '  bo: {name: Bo Chen}',
      'marks:',
      '  kbx9: {by: bo, at: 2026-10-13T22:30Z}',
      '-->',
    ].join('⏎'),
    steps: ['Shift-Enter'],
    tracking: true,
    test: (editor) =>
      newestText(editor) === 'one alph\\⏎x café' ? null : { newest: newestText(editor) },
  },
  // Code, display math and front matter (Stage 6): the keys through WebKit's own editing.
  {
    name: 'code-return-keeps-the-lines-indentation',
    doc: 'Intro.⏎⏎```js⏎  let a = 1;‸⏎```⏎⏎After.',
    steps: ['Enter'],
    caret: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ‸⏎```⏎⏎After.',
    file: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ⏎```⏎⏎After.',
  },
  {
    name: 'code-return-on-the-empty-last-line-leaves-the-block',
    doc: 'Intro.⏎⏎```js⏎let a = 1;⏎‸⏎```⏎⏎After.',
    steps: ['Enter'],
    caret: 'Intro.⏎⏎```js⏎let a = 1;⏎```⏎⏎‸⏎⏎After.',
    open: true,
  },
  {
    name: 'code-return-at-the-end-of-the-opening-fence-goes-into-the-code',
    doc: 'Intro.⏎⏎```js‸⏎let a = 1;⏎```⏎⏎After.',
    steps: ['Enter'],
    caret: 'Intro.⏎⏎```js⏎‸⏎let a = 1;⏎```⏎⏎After.',
    file: 'Intro.⏎⏎```js⏎⏎let a = 1;⏎```⏎⏎After.',
  },
  {
    name: 'code-tab-puts-in-the-languages-unit',
    doc: 'Intro.⏎⏎```js⏎‸let a = 1;⏎```⏎⏎After.',
    steps: ['Tab'],
    caret: 'Intro.⏎⏎```js⏎  ‸let a = 1;⏎```⏎⏎After.',
    file: 'Intro.⏎⏎```js⏎  let a = 1;⏎```⏎⏎After.',
  },
  {
    name: 'code-shift-tab-takes-one-unit-away',
    doc: 'Intro.⏎⏎```js⏎    ‸let a = 1;⏎```⏎⏎After.',
    steps: ['Shift-Tab'],
    caret: 'Intro.⏎⏎```js⏎  ‸let a = 1;⏎```⏎⏎After.',
    file: 'Intro.⏎⏎```js⏎  let a = 1;⏎```⏎⏎After.',
  },
  {
    // The old code struck above the new, in the author's color, as a code block's look (format §3.5).
    name: 'code-tracked-key-draws-the-old-code-struck-above-the-new',
    doc: 'Intro.⏎⏎```js⏎let a = 1‸;⏎```⏎⏎After.',
    steps: [{ type: '0' }],
    tracking: true,
    newest: 'Intro.⏎⏎```js⏎let a = 10;⏎```⏎⏎After.',
    test: (editor) => {
      editor.setViewMode('redlines');
      const content = editor.view.contentDOM;
      const struck = content.querySelector<HTMLElement>('.rl-struck.rl-codeblock');
      const line = [...content.querySelectorAll<HTMLElement>('.cm-line')].find((el) =>
        el.textContent?.includes('let a = 10;'),
      );
      if (!struck || !line) return { struck: struck?.textContent ?? null, line: line?.textContent };
      const problems: Record<string, unknown> = {};
      if (struck.textContent !== 'let a = 1;') problems['old'] = struck.textContent;
      if (!struck.querySelector('.rl-del')) problems['struck'] = 'no struck run';
      if (
        getComputedStyle(struck.querySelector('.rl-del')!).textDecorationLine !== 'line-through'
      ) {
        problems['line'] = getComputedStyle(struck.querySelector('.rl-del')!).textDecorationLine;
      }
      if (!(struck.getBoundingClientRect().bottom <= line.getBoundingClientRect().top + 1)) {
        problems['above'] = [
          struck.getBoundingClientRect().bottom,
          line.getBoundingClientRect().top,
        ];
      }
      if (content.textContent?.includes('<!--')) problems['marker'] = 'a marker is drawn';
      for (const mode of ['simple', 'clean'] as const) {
        editor.setViewMode(mode);
        if (content.querySelector('.rl-struck')) problems[mode] = 'struck code drawn';
        // Simple draws none of it, and keeps the change bar.
        if (mode === 'simple' && !content.querySelector('.rl-bar'))
          problems['bar'] = 'no bar in Simple';
      }
      return Object.keys(problems).length ? problems : null;
    },
  },
  {
    name: 'code-return-tracked-is-a-line-of-the-new-code',
    doc: 'Intro.⏎⏎```js⏎  let a = 1;‸⏎```⏎⏎After.',
    steps: ['Enter'],
    tracking: true,
    newest: 'Intro.⏎⏎```js⏎  let a = 1;⏎  ⏎```⏎⏎After.',
    test: (editor) =>
      /<!--sub \w+ /.test(editor.getDoc()) && !editor.getDoc().includes('<!--split')
        ? null
        : { file: notation(editor.getDoc()) },
  },
  {
    name: 'front-matter-return-keeps-the-lines-indentation',
    doc: '---⏎tags:⏎  - a‸⏎---⏎⏎Body.',
    steps: ['Enter'],
    caret: '---⏎tags:⏎  - a⏎  ‸⏎---⏎⏎Body.',
  },
  {
    name: 'front-matter-end-of-the-closing-line-then-return',
    doc: '---⏎title: x⏎‸---⏎⏎Body.',
    steps: ['End', 'Enter'],
    caret: '---⏎title: x⏎---⏎⏎‸⏎⏎Body.',
    file: '---⏎title: x⏎---⏎⏎Body.',
    open: true,
  },
];

const frames = async () => {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));
};

/** The key codes CodeMirror reads for Escape then Tab (`tabFocusMode`). */
const KEY_CODES: Record<string, number> = { Tab: 9, Escape: 27 };

/** Presses a key as a keyboard does, through CodeMirror's own key handling. Returns the event. */
function press(editor: Editor, key: string): KeyboardEvent {
  const parts = key.split('-');
  const name = parts.pop() ?? key;
  const event = new KeyboardEvent('keydown', {
    // A letter with Shift is the capital, as a keyboard sends it, and has its key code.
    key: name.length === 1 && parts.includes('Shift') ? name.toUpperCase() : name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    keyCode: KEY_CODES[name] ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0),
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Ctrl'),
    metaKey: parts.includes('Mod') || parts.includes('Cmd'),
    bubbles: true,
    cancelable: true,
  });
  editor.view.contentDOM.dispatchEvent(event);
  return event;
}

/**
 * A triple-click on the text at the caret, as the three `mousedown`s of one: the third has `detail`
 * 3, which CodeMirror's mouse selection styles are asked about. The mouse goes up after.
 */
async function tripleClick(view: EditorView): Promise<void> {
  const { head } = view.state.selection.main;
  const box = view.coordsAtPos(head);
  if (!box) throw new Error('the caret has no coordinates');
  const x = box.left + 1;
  const y = (box.top + box.bottom) / 2;
  const target = document.elementFromPoint(x, y) ?? view.contentDOM;
  for (const detail of [1, 2, 3]) {
    const init = { clientX: x, clientY: y, detail, button: 0, bubbles: true, cancelable: true };
    target.dispatchEvent(new MouseEvent('mousedown', init));
    document.dispatchEvent(new MouseEvent('mouseup', init));
    await frames();
  }
}

/** A click on the drawing of a task box, as the `mousedown` the box listens to. */
function clickBox(editor: Editor, index: number): void {
  const box = boxesOf(editor)[index];
  if (!box) throw new Error(`there is no task box ${index}`);
  box.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
}

/** Space on the drawing of a task box, which has the focus first, as the keyboard has it. */
function spaceOnBox(editor: Editor, index: number): void {
  const box = boxesOf(editor)[index];
  if (!(box instanceof SVGElement)) throw new Error(`there is no task box ${index}`);
  box.focus();
  box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
}

/** Waits until no notice is showing, so that a notice read after is the step's own. */
async function quiet(): Promise<void> {
  for (let waited = 0; notice() !== null && waited < 3500; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The ranges the caret steps over that the caret is strictly inside. */
function hiddenAt(view: EditorView): string[] {
  const { head } = view.state.selection.main;
  const inside: string[] = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    for (let it = source(view).iter(); it.value; it.next()) {
      if (it.from < head && head < it.to) inside.push(`${it.from}-${it.to}`);
    }
  }
  return inside;
}

async function run(editor: Editor, check: Check): Promise<unknown> {
  const { view } = editor;
  const text = lf(check.doc);
  editor.setViewMode('clean');
  editor.setTracking(check.tracking ?? false);
  // Over an empty document first: the same text loaded over the last check's open empty paragraph
  // keeps it open (an echo of the file is no change), and this check starts from nothing.
  editor.reloadDoc('');
  editor.reloadDoc(text.replace('‸', ''));
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(text.indexOf('‸')), scrollIntoView: true });
  await frames();
  if (check.select) {
    const [from, to] = check.select;
    const whole = view.state.doc.toString();
    view.dispatch({
      selection: EditorSelection.range(whole.indexOf(from), whole.indexOf(to) + to.length),
    });
    await frames();
  }
  const start = { head: view.state.selection.main.head };
  for (const step of check.steps) {
    if (typeof step === 'string') press(editor, step);
    else if ('triple' in step) await tripleClick(view);
    else if ('click' in step) clickBox(editor, step.click);
    else if ('space' in step) spaceOnBox(editor, step.space);
    else if ('quiet' in step) await quiet();
    else if ('type' in step) document.execCommand('insertText', false, step.type);
    else if ('command' in step) editor.commands.run(step.command);
    else {
      // `execCommand` fires no `beforeinput`: the event dictation and the Mac's input methods send.
      const event = new InputEvent('beforeinput', {
        inputType: step.input,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
    }
    await frames();
  }
  const { state } = view;
  const head = state.selection.main.head;
  const doc = state.doc.toString();
  const found = {
    file: notation(editor.getDoc()),
    caret: notation(doc.slice(0, head) + '‸' + doc.slice(head)),
    hiddenLines: view.contentDOM.dataset['rlHiddenLines'],
    open: view.contentDOM.dataset['rlOpenBlock'] !== undefined,
    caretInHidden: hiddenAt(view),
    caretDrawn: view.coordsAtPos(head) !== null,
    selected: state.sliceDoc(state.selection.main.from, state.selection.main.to),
  };
  const problems: string[] = [];
  if (check.test) {
    const result = check.test(editor, start);
    if (result) problems.push(`test: ${JSON.stringify(result)}`);
  }
  if (check.caret !== undefined && found.caret !== check.caret) problems.push('caret');
  if (check.file !== undefined && found.file !== check.file) problems.push('file');
  if (check.newest !== undefined && notation(newestView(editor.getDoc()).text) !== check.newest) {
    problems.push(`newest: ${notation(newestView(editor.getDoc()).text)}`);
  }
  if (check.selected !== undefined && found.selected !== check.selected) {
    problems.push(`selected: ${JSON.stringify(found.selected)}`);
  }
  if (check.open !== undefined && found.open !== check.open) problems.push('open');
  if (found.caretInHidden.length) problems.push('caret in a hidden range');
  if (!found.caretDrawn) problems.push('caret not drawn');
  return problems.length ? { problems, ...found } : null;
}

/**
 * What the page does with Tab: it is taken in a list item (it indents) and in a paragraph (nothing),
 * so the event's default is prevented, and after Escape it is the browser's, which moves the focus
 * on: the default is left alone and the text unchanged. A synthetic Tab runs no browser default;
 * press Tab by hand to see where the focus goes.
 */
async function tab(editor: Editor): Promise<unknown> {
  const problems: string[] = [];
  editor.setViewMode('clean');
  editor.setTracking(false);
  const load = async (doc: string) => {
    const text = lf(doc);
    editor.reloadDoc('');
    editor.reloadDoc(text.replace('‸', ''));
    editor.view.focus();
    editor.view.dispatch({ selection: EditorSelection.cursor(text.indexOf('‸')) });
    await frames();
  };
  await load('- one⏎- ‸two');
  const inItem = press(editor, 'Tab');
  await frames();
  if (!inItem.defaultPrevented) problems.push('Tab in an item was left to the browser');
  if (editor.getDoc() !== '- one\n  - two') problems.push('Tab in an item did not indent');
  await load('One t‸wo.');
  const inParagraph = press(editor, 'Tab');
  await frames();
  if (!inParagraph.defaultPrevented) problems.push('Tab in a paragraph was left to the browser');
  if (editor.getDoc() !== 'One two.') problems.push('Tab in a paragraph changed the text');
  await load('- one⏎- ‸two');
  press(editor, 'Escape');
  const after = press(editor, 'Tab');
  await frames();
  if (after.defaultPrevented) problems.push('Tab after Escape was taken by the page');
  if (editor.getDoc() !== '- one\n- two') problems.push('Tab after Escape changed the text');
  return problems.length ? { problems } : null;
}

const lines: string[] = [];

/** A line reported: in the console, and in `data-block-check` on the page's root, for a driver. */
const report = (line: string) => {
  console.log(line);
  lines.push(line);
  document.documentElement.dataset['blockCheck'] = lines.join('\n');
};

export async function runBlockCheck(editor: Editor): Promise<void> {
  let passed = 0;
  let failed = 0;
  for (const check of CHECKS) {
    try {
      const failure = await run(editor, check);
      if (failure) {
        failed++;
        report(`BLOCK-CHECK ${check.name} FAIL ${JSON.stringify(failure)}`);
      } else {
        passed++;
        report(`BLOCK-CHECK ${check.name} pass`);
      }
    } catch (error) {
      failed++;
      report(`BLOCK-CHECK ${check.name} FAIL ${JSON.stringify({ threw: String(error) })}`);
    }
  }
  try {
    const failure = await tab(editor);
    if (failure) {
      failed++;
      report(`BLOCK-CHECK tab FAIL ${JSON.stringify(failure)}`);
    } else {
      passed++;
      report('BLOCK-CHECK tab pass');
    }
  } catch (error) {
    failed++;
    report(`BLOCK-CHECK tab FAIL ${JSON.stringify({ threw: String(error) })}`);
  }
  editor.setTracking(false);
  editor.reloadDoc(sample);
  report(`BLOCK-CHECK done ${passed} passed, ${failed} failed`);
}
