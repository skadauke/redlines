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
// with three clicks in its `detail`, aimed at the text's own coordinates.

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
  /** A triple-click on the text at the caret's start position. */
  | { triple: true };

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
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    keyCode: KEY_CODES[name] ?? 0,
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
  editor.reloadDoc(text.replace('‸', ''));
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(text.indexOf('‸')), scrollIntoView: true });
  await frames();
  const start = { head: view.state.selection.main.head };
  for (const step of check.steps) {
    if (typeof step === 'string') press(editor, step);
    else if ('triple' in step) await tripleClick(view);
    else if ('type' in step) document.execCommand('insertText', false, step.type);
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

export async function runBlockCheck(editor: Editor): Promise<void> {
  let passed = 0;
  let failed = 0;
  for (const check of CHECKS) {
    try {
      const failure = await run(editor, check);
      if (failure) {
        failed++;
        console.log(`BLOCK-CHECK ${check.name} FAIL ${JSON.stringify(failure)}`);
      } else {
        passed++;
        console.log(`BLOCK-CHECK ${check.name} pass`);
      }
    } catch (error) {
      failed++;
      console.log(`BLOCK-CHECK ${check.name} FAIL ${JSON.stringify({ threw: String(error) })}`);
    }
  }
  try {
    const failure = await tab(editor);
    if (failure) {
      failed++;
      console.log(`BLOCK-CHECK tab FAIL ${JSON.stringify(failure)}`);
    } else {
      passed++;
      console.log('BLOCK-CHECK tab pass');
    }
  } catch (error) {
    failed++;
    console.log(`BLOCK-CHECK tab FAIL ${JSON.stringify({ threw: String(error) })}`);
  }
  editor.setTracking(false);
  editor.reloadDoc(sample);
  console.log(`BLOCK-CHECK done ${passed} passed, ${failed} failed`);
}
