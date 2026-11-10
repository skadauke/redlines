// @vitest-environment happy-dom
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { editSourceFacet } from '../tracked/typing.ts';
import {
  openAnnotation,
  openBlock,
  returnAnnotation,
  setOpenEffect,
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
      openAnnotation.of({ at, assoc: 1, pressedIn: { at, assoc: -1 } }),
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
