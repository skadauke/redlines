// @vitest-environment happy-dom
// HTML containers (#688): what is a container, how a `<details>` folds, what holds it open, and
// the keys that keep GitHub's blank lines.
import { forceParsing } from '@codemirror/language';
import { runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditor,
  type Editor,
  containersOf,
  holdOpenAt,
  isSectionOpen,
  setFold,
} from '../index.ts';
import { hiddenLines } from '../tracked/decorations.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function load(doc: string, caret = 0): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  editor.view.dispatch({ selection: { anchor: caret } });
  editors.push(editor);
  return editor;
}

const SECTION = '<details>\n<summary>More</summary>\n\nInside.\n\n</details>\n\nAfter.';

/** The lines the editor draws. */
const drawn = (editor: Editor) =>
  [...editor.view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');

const open = (editor: Editor) =>
  isSectionOpen(editor.view.state, containersOf(editor.view.state)[0]!);
const press = (editor: Editor, key: string) =>
  runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key }), 'editor');

describe('containers', () => {
  it('reads details with a summary, and div with align', () => {
    const editor = load(`${SECTION}\n\n<div align="center">\n\nMiddle.\n\n</div>`);
    const found = containersOf(editor.view.state);
    expect(found.map((c) => [c.kind, c.align])).toEqual([
      ['details', null],
      ['div', 'center'],
    ]);
    expect(editor.view.state.sliceDoc(found[0]!.summary!.textFrom, found[0]!.summary!.textTo)).toBe(
      'More',
    );
  });

  it('is no container when the tag has other text in its block', () => {
    const editor = load('<details>\n<summary>More</summary>\nInside.\n</details>');
    expect(containersOf(editor.view.state)).toHaveLength(0);
  });

  it('nests, and matches each closing tag with its own opener', () => {
    const editor = load(
      '<details>\n<summary>A</summary>\n\n<details>\n<summary>B</summary>\n\nx\n\n</details>\n\ny\n\n</details>',
    );
    const [outer, inner] = containersOf(editor.view.state);
    expect(inner!.parent).toBe(0);
    expect(inner!.end).toBeLessThan(outer!.end);
  });

  it('folds an unclosed details to the end of the document', () => {
    const editor = load('<details>\n<summary>A</summary>\n\nOne.\n\nTwo.');
    const [only] = containersOf(editor.view.state);
    expect(only!.closer).toBeNull();
    expect(only!.end).toBe(editor.view.state.doc.length);
  });
});

describe('folding', () => {
  it('is closed by default: the summary shows, its content does not', () => {
    const editor = load(SECTION);
    expect(open(editor)).toBe(false);
    expect(drawn(editor).join('|')).toContain('More');
    expect(drawn(editor).join('|')).not.toContain('Inside.');
    expect(drawn(editor).join('|')).toContain('After.');
    expect(drawn(editor).join('|')).not.toContain('<details>');
  });

  it('is open when the file says open, and a toggle wins over the file', () => {
    const editor = load(SECTION.replace('<details>', '<details open>'));
    expect(open(editor)).toBe(true);
    expect(drawn(editor).join('|')).toContain('Inside.');
    editor.view.dispatch({ effects: setFold.of({ from: 0, open: false }) });
    expect(open(editor)).toBe(false);
    expect(drawn(editor).join('|')).not.toContain('Inside.');
  });

  it('hides the content as one run the caret steps over, so Down skips it', () => {
    const editor = load(SECTION);
    const { state } = editor.view;
    const runs: string[] = [];
    hiddenLines(state).between(0, state.doc.length, (from, to) => {
      runs.push(state.sliceDoc(from, to));
    });
    expect(runs.some((run) => run.includes('Inside.') && run.includes('</details>'))).toBe(true);
  });

  it('toggles from the summary line with a key, and not from elsewhere', () => {
    const editor = load(SECTION, SECTION.indexOf('More') + 2);
    editor.view.dispatch({ effects: setFold.of({ from: 0, open: true }) });
    expect(open(editor)).toBe(true);
    editor.view.dispatch({ selection: { anchor: SECTION.indexOf('After.') } });
    // The caret is not on the summary line.
    const before = open(editor);
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, altKey: true, metaKey: true }),
      'editor',
    );
    expect(open(editor)).toBe(before);
  });

  it('keeps nothing of a toggle in the file', () => {
    const editor = load(SECTION);
    editor.view.dispatch({ effects: setFold.of({ from: 0, open: true }) });
    expect(editor.getDoc()).toBe(SECTION);
  });

  it('draws the summary of a details with none as Details', () => {
    const editor = load('<details>\n\nBody.\n\n</details>');
    expect(drawn(editor).join('|')).toContain('Details');
  });
});

describe('what holds a section open', () => {
  it('opens for a selection inside it, and closes again when the selection leaves', () => {
    const editor = load(SECTION);
    const inside = SECTION.indexOf('Inside.');
    editor.view.dispatch({ selection: { anchor: inside, head: inside + 3 } });
    expect(open(editor)).toBe(true);
    expect(drawn(editor).join('|')).toContain('Inside.');
    editor.view.dispatch({ selection: { anchor: SECTION.indexOf('After.') } });
    expect(open(editor)).toBe(false);
  });

  it('opens for the current match of Find and closes when the match moves out', () => {
    const editor = load(SECTION);
    const inside = SECTION.indexOf('Inside.');
    editor.view.dispatch({
      effects: holdOpenAt.of(inside),
      selection: { anchor: inside, head: inside + 7 },
    });
    expect(open(editor)).toBe(true);
    editor.view.dispatch({
      effects: holdOpenAt.of(SECTION.indexOf('After.')),
      selection: { anchor: SECTION.indexOf('After.'), head: SECTION.indexOf('After.') + 5 },
    });
    expect(open(editor)).toBe(false);
  });

  it('stays open under typing inside, and opens nothing for a change elsewhere', () => {
    const editor = load(SECTION);
    const inside = SECTION.indexOf('Inside.');
    editor.view.dispatch({ selection: { anchor: inside } });
    editor.view.dispatch({
      changes: { from: inside, insert: 'x' },
      selection: { anchor: inside + 1 },
    });
    expect(open(editor)).toBe(true);
    editor.view.dispatch({ changes: { from: editor.getDoc().length, insert: ' More.' } });
    expect(open(editor)).toBe(true);
  });
});

describe('changes never hide', () => {
  it('shows a count and a bar on the summary line of a closed section', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: SECTION, author: ada, tracking: true });
    editors.push(editor);
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    const inside = SECTION.indexOf('Inside.');
    editor.view.dispatch({ selection: { anchor: inside } });
    editor.view.dispatch({
      changes: { from: inside, insert: 'new ' },
      selection: { anchor: inside + 4 },
      userEvent: 'input.type',
    });
    expect(editor.getDoc()).toContain('<!--ins');
    // The caret leaves: the section closes, and says what it holds.
    editor.view.dispatch({ selection: { anchor: editor.getDoc().indexOf('After.') } });
    expect(open(editor)).toBe(false);
    expect(editor.view.contentDOM.querySelector('.rl-fold-count')?.textContent).toBe('1 change');
    expect(editor.view.contentDOM.querySelector('.rl-summary-changes')).not.toBeNull();
  });
});

describe('keys', () => {
  it('never joins a paragraph into a tag line', () => {
    const editor = load(SECTION, SECTION.indexOf('Inside.'));
    const before = editor.getDoc();
    expect(press(editor, 'Backspace')).toBe(true);
    expect(editor.getDoc()).toBe(before);
    editor.view.dispatch({ selection: { anchor: SECTION.indexOf('Inside.') + 7 } });
    expect(press(editor, 'Delete')).toBe(true);
    expect(editor.getDoc()).toBe(before);
    // The paragraph after the section is not joined into its closing tag either.
    editor.view.dispatch({ selection: { anchor: SECTION.indexOf('After.') } });
    expect(press(editor, 'Backspace')).toBe(true);
    expect(editor.getDoc()).toBe(before);
  });

  it('leaves Backspace inside text alone', () => {
    const editor = load(SECTION, SECTION.indexOf('Inside.') + 3);
    press(editor, 'Backspace');
    expect(editor.getDoc()).toContain('Inide.');
  });

  it('keeps the summary line break: Backspace at its start and Delete at its end do nothing', () => {
    const editor = load(SECTION, SECTION.indexOf('More'));
    const before = editor.getDoc();
    expect(press(editor, 'Backspace')).toBe(true);
    editor.view.dispatch({ selection: { anchor: SECTION.indexOf('More') + 4 } });
    expect(press(editor, 'Delete')).toBe(true);
    expect(editor.getDoc()).toBe(before);
  });
});

describe('review fixes', () => {
  it('an unclosed details inside a closed div ends where the div does', () => {
    const doc = '<div>\n\n<details>\n<summary>A</summary>\n\nOne.\n\n</div>\n\nAfter.';
    const editor = load(doc);
    const [, inner] = containersOf(editor.view.state);
    expect(inner!.end).toBeLessThan(doc.indexOf('</div>'));
    expect(drawn(editor).join('|')).toContain('After.');
  });

  it('forgets the toggle of a section that an edit took away', () => {
    const editor = load(`${SECTION}`);
    editor.view.dispatch({ effects: setFold.of({ from: 0, open: true }) });
    editor.view.dispatch({ changes: { from: 0, to: SECTION.indexOf('After.') } });
    editor.view.dispatch({
      changes: { from: 0, insert: `${SECTION.slice(0, SECTION.indexOf('After.'))}` },
    });
    expect(open(editor)).toBe(false);
  });
});

describe('div align', () => {
  it('hides the tag lines and aligns the Markdown inside', () => {
    const editor = load('<div align="center">\n\nMiddle.\n\n</div>\n\nAfter.');
    expect(drawn(editor).join('|')).not.toContain('<div');
    const middle = [...editor.view.contentDOM.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('Middle.'),
    );
    expect(middle?.classList.contains('rl-align-center')).toBe(true);
  });
});
