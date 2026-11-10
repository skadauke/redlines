// @vitest-environment happy-dom
import { isolateHistory } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { changedOutside, redo, undo } from '../history/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import {
  openAnnotation,
  openBlock,
  pointerEffect,
  recordField,
  returnAnnotation,
  setOpenEffect,
  takeBack,
  textWithoutOpen,
} from './open.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const mounted: Editor[] = [];

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** `⏎` as a line break. */
const lf = (text: string) => text.replaceAll('⏎', '\n');

interface Mounted {
  editor: Editor;
  /** The texts `onChange` was given, in order. */
  changes: string[];
}

function mount(doc: string, options: { tracking?: boolean } = {}): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const changes: string[] = [];
  let n = 0;
  const editor = createEditor(parent, {
    doc: lf(doc),
    author: ada,
    tracking: options.tracking ?? false,
    onChange: (text) => changes.push(text),
    extensions: [
      editSourceFacet.of({
        now: () => new Date('2026-11-01T10:00Z'),
        random: (k) => Uint8Array.from({ length: k }, () => n++ % 19),
      }),
    ],
  });
  mounted.push(editor);
  return { editor, changes };
}

/**
 * What a Return at the end of a block does, as Task 1.13's key will: two line breaks at `at`, the
 * caret on the empty line between them and the next block, which is the open block.
 */
function returnAt(editor: Editor, at: number, insert = '\n\n'): void {
  editor.view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    annotations: [
      openAnnotation.of({ at, assoc: 1, pressedIn: { from: 0, to: at } }),
      returnAnnotation.of(true),
    ],
    userEvent: 'input.break',
  });
}

const text = (editor: Editor) => editor.view.state.doc.toString();

describe('the empty paragraph', () => {
  it('is left out of the file and of onChange, and a Return alone edits nothing', () => {
    const { editor, changes } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    expect(text(editor)).toBe(lf('One two.⏎⏎⏎⏎Next.'));
    expect(openBlock(editor.view.state)).not.toBeNull();
    expect(editor.getDoc()).toBe(lf('One two.⏎⏎Next.'));
    expect(textWithoutOpen(editor.view.state)).toBe(lf('One two.⏎⏎Next.'));
    // The host's edited state comes from onChange, which isn't told of a text that didn't change.
    expect(changes).toEqual([]);
  });

  it('is on the page, for the checks by hand', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    expect(editor.view.contentDOM.dataset.rlOpenBlock).toBe('3');
  });

  it('goes when the caret leaves it, and the file is as it was', () => {
    const { editor, changes } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Next') + 2 } });
    expect(text(editor)).toBe(lf('One two.⏎⏎Next.'));
    expect(openBlock(editor.view.state)).toBeNull();
    expect(editor.view.state.selection.main.head).toBe('One two.⏎⏎Ne'.length);
    expect(changes).toEqual([]);
    expect(editor.view.contentDOM.dataset.rlOpenBlock).toBeUndefined();
  });

  it('stays open while the caret is in the block Return was pressed in', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(text(editor)).toBe(lf('One two.⏎⏎⏎⏎Next.'));
    expect(openBlock(editor.view.state)).not.toBeNull();
  });

  it('is a paragraph once something is typed in it', () => {
    const { editor, changes } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(openBlock(editor.view.state)).toBeNull();
    expect(editor.getDoc()).toBe(lf('One two.⏎⏎X⏎⏎Next.'));
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Next') } });
    expect(editor.getDoc()).toBe(lf('One two.⏎⏎X⏎⏎Next.'));
    expect(changes).toEqual([lf('One two.⏎⏎X⏎⏎Next.')]);
  });

  it('goes before the view switches to Raw', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    editor.setViewMode('raw');
    expect(text(editor)).toBe(lf('One two.⏎⏎Next.'));
    expect(openBlock(editor.view.state)).toBeNull();
    expect(editor.getUiState().view).toBe('raw');
  });

  it('is what an empty document is, and the file is empty', () => {
    const { editor } = mount('');
    expect(editor.getDoc()).toBe('');
    editor.view.dispatch(editor.view.state.replaceSelection('A'), { userEvent: 'input.type' });
    editor.view.dispatch({ changes: { from: 0, to: 1 }, userEvent: 'delete.backward' });
    expect(openBlock(editor.view.state)).not.toBeNull();
    expect(editor.getDoc()).toBe('');
  });

  it('opens above the ledger and leaves it untouched (Review Focus)', () => {
    const ledger = '<!-- redlines⏎version: 1⏎marks:⏎  b2b2: {by: ada, at: 2026-11-01T10:00Z}⏎-->⏎';
    const file = `One <!--ins b2b2-->two<!--/b2b2-->.⏎⏎${ledger}`;
    for (const tracking of [false, true]) {
      const { editor } = mount(file, { tracking });
      const at = lf(file).indexOf('.\n') + 1;
      returnAt(editor, at);
      // With Track Changes on, the format writes its ledger's header comment with the first edit.
      if (!tracking) expect(text(editor)).toBe(lf(file).replace('.\n\n', '.\n\n\n\n'));
      expect(text(editor)).toContain('.\n\n\n\n<!-- redlines');
      expect(editor.getDoc()).toBe(lf(file));
      // In the block Return was pressed in, it stays open.
      editor.view.dispatch({ selection: { anchor: 2 } });
      expect(editor.getDoc()).toBe(lf(file));
      editor.setViewMode('raw');
      expect(text(editor)).toBe(lf(file));
    }
  });

  it('keeps a CRLF file byte for byte while it is open', () => {
    const file = 'One two.\r\n\r\nNext.\r\n';
    const { editor } = mount(file);
    returnAt(editor, 'One two.'.length);
    expect(editor.getDoc()).toBe(file);
    editor.view.dispatch({ selection: { anchor: 1 } });
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Next') } });
    expect(editor.getDoc()).toBe(file);
  });

  it('opens on an empty line between blank lines the caret is left on, and goes when it leaves', () => {
    // Deleting all of a paragraph's text with Track Changes off.
    const { editor } = mount('One.⏎⏎Two.⏎⏎Three.');
    const from = 'One.⏎⏎'.length;
    editor.view.dispatch({
      changes: { from, to: from + 4 },
      selection: { anchor: from },
      userEvent: 'delete.backward',
    });
    expect(openBlock(editor.view.state)).not.toBeNull();
    expect(editor.getDoc()).toBe(lf('One.⏎⏎Three.'));
    editor.view.dispatch({ selection: { anchor: 1 } });
    expect(text(editor)).toBe(lf('One.⏎⏎Three.'));
  });

  it('is set and closed by an effect', () => {
    const { editor } = mount('One.⏎⏎⏎⏎Two.');
    const line = editor.view.state.doc.line(3);
    editor.view.dispatch({
      selection: { anchor: line.from },
      effects: setOpenEffect.of({ empty: { from: line.from, to: line.to }, pressedIn: null }),
    });
    expect(editor.getDoc()).toBe(lf('One.⏎⏎Two.'));
    editor.view.dispatch({ effects: setOpenEffect.of(null) });
    expect(editor.getDoc()).toBe(lf('One.⏎⏎⏎⏎Two.'));
  });
});

describe('the blocks while it is open', () => {
  /** The spacing classes of the line that starts with `start`. */
  const spaceOf = (editor: Editor, start: string) => {
    const lines = [...editor.view.contentDOM.querySelectorAll('.cm-line')];
    const line = lines.find((l) => l.textContent.endsWith(start));
    return [...(line?.classList ?? [])].filter((c) => c.startsWith('rl-space-'));
  };

  it('reads a list it parts as if it held a character: two lists, not one loose list', () => {
    const { editor } = mount('- one⏎- two');
    // The empty paragraph that Return on an empty item in the middle of a list leaves.
    editor.view.dispatch({
      changes: { from: '- one'.length, insert: '\n\n\n' },
      selection: EditorSelection.cursor('- one⏎⏎'.length),
      annotations: openAnnotation.of({ at: '- one'.length, assoc: 1 }),
    });
    expect(text(editor)).toBe(lf('- one⏎⏎⏎⏎- two'));
    const line = editor.view.state.doc.line(3);
    editor.view.dispatch({
      selection: { anchor: line.from },
      effects: setOpenEffect.of({ empty: { from: line.from, to: line.to }, pressedIn: null }),
    });
    expect(spaceOf(editor, 'two')).toEqual(['rl-space-block']);
    // The empty paragraph is drawn with the space of a paragraph.
    const open = [...editor.view.contentDOM.querySelectorAll('.cm-line')].find(
      (l) => l.textContent === '',
    );
    expect([...(open?.classList ?? [])]).toContain('rl-space-block');
  });

  it('numbers a numbered list it parts as two lists', () => {
    const { editor } = mount('1. one⏎⏎⏎⏎1. two');
    const line = editor.view.state.doc.line(3);
    editor.view.dispatch({
      selection: { anchor: line.from },
      effects: setOpenEffect.of({ empty: { from: line.from, to: line.to }, pressedIn: null }),
    });
    const marks = () =>
      [...editor.view.contentDOM.querySelectorAll('.rl-list-mark')].map((m) => m.textContent);
    expect(marks()).toEqual(['1.', '1.']);
    editor.view.dispatch({ effects: setOpenEffect.of(null) });
    expect(marks()).toEqual(['1.', '2.']);
  });
});

/** A Return in the middle of a block, as Task 1.13's key will make it: a paragraph break there. */
function splitAt(editor: Editor, at: number): void {
  editor.view.dispatch({
    changes: { from: at, insert: '\n\n' },
    selection: EditorSelection.cursor(at + 2),
    annotations: [returnAnnotation.of(true), isolateHistory.of('full')],
    userEvent: 'input.break',
  });
}

describe('the record of Returns', () => {
  it('takes two Returns back one at a time, byte for byte, with Track Changes on and off', () => {
    const file = 'One two three.⏎⏎<!-- redlines⏎version: 1⏎-->⏎';
    for (const tracking of [false, true]) {
      const { editor } = mount(file, { tracking });
      splitAt(editor, 'One '.length);
      const once = text(editor);
      const caret = editor.view.state.selection.main.head;
      splitAt(editor, caret + 'two '.length);
      expect(editor.view.state.field(recordField)).toHaveLength(2);
      const left = editor.view.state.selection.main.head;
      // Only from where the last Return left the caret.
      editor.view.dispatch({ selection: { anchor: 0 } });
      expect(takeBack(editor.view)).toBe(false);
      editor.view.dispatch({ selection: { anchor: left } });
      expect(takeBack(editor.view)).toBe(true);
      expect(text(editor)).toBe(once);
      expect(editor.view.state.selection.main.head).toBe(caret);
      expect(takeBack(editor.view)).toBe(true);
      expect(text(editor)).toBe(lf(file));
      expect(editor.getDoc()).toBe(lf(file));
      expect(takeBack(editor.view)).toBe(false);
      // Each take-back is a step of its own: Undo brings the Return back.
      undo(editor.view);
      expect(text(editor)).toBe(once);
      expect(editor.getUiState().undo).toBe('Typing');
    }
  });

  it('ends with any other edit', () => {
    const { editor } = mount('One two.');
    splitAt(editor, 'One '.length);
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(editor.view.state.field(recordField)).toEqual([]);
    expect(takeBack(editor.view)).toBe(false);
  });

  it('gives back the view a Return switched from', () => {
    const { editor } = mount('One two.', { tracking: true });
    expect(editor.getUiState().view).toBe('clean');
    splitAt(editor, 'One '.length);
    expect(editor.getUiState().view).toBe('redlines');
    expect(takeBack(editor.view)).toBe(true);
    expect(editor.getUiState().view).toBe('clean');
    expect(editor.getDoc()).toBe('One two.');
  });

  it('survives switching between Clean and Redlines', () => {
    const { editor } = mount('One two.');
    splitAt(editor, 'One '.length);
    editor.setViewMode('redlines');
    editor.setViewMode('clean');
    expect(takeBack(editor.view)).toBe(true);
    expect(text(editor)).toBe('One two.');
  });

  it('leaves the history as before the Returns when leaving takes them back', () => {
    for (const tracking of [false, true]) {
      const { editor } = mount('One two.⏎⏎Next.', { tracking });
      editor.view.dispatch({
        changes: { from: 3, insert: 'X' },
        selection: { anchor: 4 },
        userEvent: 'input.type',
      });
      const typed = text(editor);
      editor.view.dispatch({ annotations: isolateHistory.of('full') });
      returnAt(editor, typed.indexOf('.\n') + 1);
      editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Next') } });
      expect(text(editor)).toBe(typed);
      expect(changedOutside(editor.view.state)).toBe(false);
      // Undo undoes what came before the Returns.
      undo(editor.view);
      expect(text(editor)).toBe(lf('One two.⏎⏎Next.'));
      redo(editor.view);
      expect(text(editor)).toBe(typed);
    }
  });

  it.each([
    ['leaving a list', '- one⏎- ‸⏎⏎After.'],
    ['leaving a quote', '> one‸⏎⏎After.', 2],
    ['the empty item that holds nested items', '- one⏎- ‸⏎  - sub'],
    ['leaving a list in a quote at the end of the file', '> - one⏎> - ‸'],
  ] as [string, string, number?][])(
    'leaves no step of a Return that deleted text in the history, %s (review C1)',
    (_, doc, returns = 1) => {
      for (const tracking of [false, true]) {
        const at = lf(doc).indexOf('‸');
        const { editor } = mount(doc.replace('‸', ''), { tracking });
        const { view } = editor;
        // Something to undo before the Return: a letter typed after `one`.
        const one = lf(doc).indexOf('one') + 3;
        view.dispatch({ selection: { anchor: one } });
        view.dispatch(view.state.replaceSelection('X'), { userEvent: 'input.type' });
        const typed = text(editor);
        // The caret where `‸` was: after the text between `one` and it, past the letter's markers.
        const between = lf(doc).slice(one, at);
        view.dispatch({
          selection: {
            anchor: between
              ? typed.indexOf(between, one) + between.length
              : view.state.selection.main.head,
          },
          annotations: isolateHistory.of('full'),
        });
        for (let i = 0; i < returns; i++) {
          const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
          expect(runScopeHandlers(view, enter, 'editor')).toBe(true);
        }
        expect(openBlock(view.state), `${tracking}: open`).not.toBeNull();
        // Leaving the empty paragraph takes the Return back.
        view.dispatch({ selection: { anchor: 0 } });
        expect(text(editor), `${tracking}: taken back`).toBe(typed);
        // Undo undoes the letter, and only it: no step of the Return is left to replay.
        undo(view);
        expect(text(editor), `${tracking}: undo`).toBe(lf(doc.replace('‸', '')));
        redo(view);
        expect(text(editor), `${tracking}: redo`).toBe(typed);
      }
    },
  );

  it.each([119, 120, 130, 250])(
    'leaves no step of the Return to replay when the history has been trimmed, %i steps before it (review D C1)',
    (steps) => {
      for (const tracking of [false, true]) {
        const doc = '- one⏎- ⏎⏎After.';
        const { editor } = mount(doc, { tracking });
        const { view } = editor;
        const texts = new Set([text(editor)]);
        // Steps before the Return, each its own: letters typed after `After.`.
        for (let i = 0; i < steps; i++) {
          view.dispatch({ selection: { anchor: view.state.doc.length } });
          view.dispatch(view.state.replaceSelection('x'), {
            userEvent: 'input.type',
            annotations: isolateHistory.of('full'),
          });
          texts.add(text(editor));
        }
        const typed = text(editor);
        view.dispatch({
          selection: { anchor: lf('- one⏎- ').length },
          annotations: isolateHistory.of('full'),
        });
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        expect(runScopeHandlers(view, enter, 'editor')).toBe(true);
        expect(openBlock(view.state), `${tracking}: open`).not.toBeNull();
        view.dispatch({ selection: { anchor: 0 } });
        expect(text(editor), `${tracking}: taken back`).toBe(typed);
        // Every ⌘Z gives a text the document had, and none throws.
        let undone = 0;
        while (undo(view)) {
          undone++;
          expect(texts.has(text(editor)), `${tracking}: undo ${undone}`).toBe(true);
        }
        expect(undone, `${tracking}: steps undone`).toBeGreaterThan(0);
        // ⇧⌘Z all the way gives the text before the Return back.
        while (redo(view));
        expect(text(editor), `${tracking}: redo`).toBe(typed);
      }
    },
  );

  it.each([
    ['the empty item that holds nested items', '- one⏎- ‸⏎  - sub'],
    ['leaving a list in a quote', '> - one⏎> - ‸'],
  ])(
    'opens the empty paragraph where the caret is at the end of a file with no ledger yet, %s (review C2)',
    (_, doc) => {
      for (const tracking of [false, true]) {
        const { editor } = mount(doc.replace('‸', ''), { tracking });
        const { view } = editor;
        view.dispatch({ selection: { anchor: lf(doc).indexOf('‸') } });
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        runScopeHandlers(view, enter, 'editor');
        const open = openBlock(view.state);
        const { head } = view.state.selection.main;
        expect(open, `${tracking}: open`).not.toBeNull();
        expect(head >= open!.empty.from && head <= open!.empty.to, `${tracking}: caret`).toBe(true);
        // A transaction that changes nothing leaves it open, and a letter goes in it.
        view.dispatch({ annotations: isolateHistory.of('full') });
        expect(openBlock(view.state), `${tracking}: still open`).not.toBeNull();
        view.dispatch(view.state.replaceSelection('Y'), { userEvent: 'input.type' });
        const line = view.state.doc.lineAt(view.state.selection.main.head).text;
        expect(line.replace(/<!--[^]*?-->/g, ''), `${tracking}: typed`).toMatch(/^[> ]*Y$/);
      }
    },
  );

  it('takes the empty paragraph away as a step of its own when something was done between', () => {
    const file =
      'One <!--ins b2b2-->two<!--/b2b2-->.⏎⏎Next.⏎⏎<!-- redlines⏎version: 1⏎marks:⏎' +
      '  b2b2: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';
    const { editor } = mount(file);
    returnAt(editor, lf(file).indexOf('.\n') + 1);
    // A decision while it is open: the file gets no stray blank line (Review Focus).
    editor.accept('b2b2');
    expect(editor.getDoc()).toBe(lf('One two.⏎⏎Next.⏎'));
    expect(openBlock(editor.view.state)).not.toBeNull();
    editor.view.dispatch({ selection: { anchor: text(editor).indexOf('Next') } });
    expect(text(editor)).toBe(lf('One two.⏎⏎Next.⏎'));
    // Undo brings it back, with the caret in it.
    undo(editor.view);
    expect(text(editor)).toBe(lf('One two.⏎⏎⏎⏎Next.⏎'));
    expect(editor.view.state.selection.main.head).toBe('One two.⏎⏎'.length);
    expect(openBlock(editor.view.state)).not.toBeNull();
  });

  it('waits for the mouse button to come up before taking the empty paragraph back', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    const opened = text(editor);
    // What the editor's mousedown and mouseup listeners dispatch: under happy-dom, CodeMirror's own
    // mouse selection can't run.
    editor.view.dispatch({ effects: pointerEffect.of(true) });
    editor.view.dispatch({
      selection: { anchor: opened.indexOf('Next') + 1 },
      userEvent: 'select.pointer',
    });
    // The text under the pointer doesn't move while the button is down.
    expect(text(editor)).toBe(opened);
    editor.view.dispatch({ effects: pointerEffect.of(false) });
    expect(text(editor)).toBe(lf('One two.⏎⏎Next.'));
    expect(editor.view.state.selection.main.head).toBe('One two.⏎⏎N'.length);
  });

  it('keeps the empty paragraph open through an agent’s edit above it', () => {
    const { editor } = mount('Title.⏎⏎One two.⏎⏎Next.');
    returnAt(editor, 'Title.⏎⏎One two.'.length);
    editor.reloadDoc(lf('Title, by Claude.⏎⏎One two.⏎⏎Next.'));
    expect(text(editor)).toBe(lf('Title, by Claude.⏎⏎One two.⏎⏎⏎⏎Next.'));
    expect(editor.getDoc()).toBe(lf('Title, by Claude.⏎⏎One two.⏎⏎Next.'));
    expect(editor.view.state.selection.main.head).toBe('Title, by Claude.⏎⏎One two.⏎⏎'.length);
    expect(openBlock(editor.view.state)).not.toBeNull();
    // Typing lands in the empty paragraph.
    editor.view.dispatch(editor.view.state.replaceSelection('X'), { userEvent: 'input.type' });
    expect(editor.getDoc()).toBe(lf('Title, by Claude.⏎⏎One two.⏎⏎X⏎⏎Next.'));
  });

  it('keeps it through a change of the block above, and an agent’s edit through applyAgentEdit', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    editor.applyAgentEdit(lf('One two, three.⏎⏎Next.'), { group: 'run-1', agent: 'Claude' });
    expect(text(editor)).toBe(lf('One two, three.⏎⏎⏎⏎Next.'));
    expect(editor.view.state.selection.main.head).toBe('One two, three.⏎⏎'.length);
  });

  it('puts the caret at the end of the block above when an edit takes a block beside it away', () => {
    const { editor } = mount('One two.⏎⏎Next.⏎⏎Last.');
    returnAt(editor, 'One two.'.length);
    editor.reloadDoc(lf('One two.⏎⏎Last.'));
    expect(text(editor)).toBe(lf('One two.⏎⏎Last.'));
    expect(openBlock(editor.view.state)).toBeNull();
    expect(editor.view.state.selection.main.head).toBe('One two.'.length);
  });

  it('does nothing to the document on a reload of the file it has', () => {
    const { editor } = mount('One two.⏎⏎Next.');
    returnAt(editor, 'One two.'.length);
    const opened = text(editor);
    editor.reloadDoc(lf('One two.⏎⏎Next.'));
    expect(text(editor)).toBe(opened);
    expect(openBlock(editor.view.state)).not.toBeNull();
  });
});
