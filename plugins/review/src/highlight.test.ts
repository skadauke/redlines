// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { baseTitle, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { highlightsAt, highlightTitle } from './highlight.ts';
import { HIGHLIGHT_COMMAND } from './index.ts';
import { file, mount, PEOPLE, press, thread, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

/** A file with no redlines, which opens Clean. */
const plain = file('The importer ships in April.', PEOPLE);

/** Bo's highlight on a word, and Ada's on another, in the people's ledger. */
const MARKS = [
  ...PEOPLE,
  'marks:',
  '  h4kz: {by: bo, at: 2026-10-31T09:41Z}',
  '  w8nn: {by: ada, at: 2026-10-31T09:42Z}',
];
const marked = file(
  'The <!--hl h4kz-->importer<!--/h4kz--> ships in <!--hl w8nn-->April<!--/w8nn-->.',
  MARKS,
);

/** Where `needle` is in the editor's text. */
const place = (editor: Editor, needle: string) => {
  const from = editor.view.state.doc.toString().indexOf(needle);
  expect(from, needle).toBeGreaterThanOrEqual(0);
  return { from, to: from + needle.length };
};
const select = (editor: Editor, needle: string) => {
  const { from, to } = place(editor, needle);
  editor.view.dispatch({ selection: { anchor: from, head: to } });
};
const caretAt = (editor: Editor, position: number) =>
  editor.view.dispatch({ selection: { anchor: position } });
const doc = (editor: Editor) => editor.view.state.doc.toString();
const highlights = (editor: Editor) =>
  editor.getParsed().marks.filter((mark) => mark.kind === 'hl');
/** What the selection covers. */
const selected = (editor: Editor) => {
  const { from, to } = editor.view.state.selection.main;
  return editor.view.state.sliceDoc(from, to);
};
const command = (editor: Editor) =>
  editor.commands.list().find(({ id }) => id === HIGHLIGHT_COMMAND);
const activeIds = (editor: Editor) => editor.getUiState().activeCommands;
const titleOf = (editor: Editor) => editor.getUiState().commandTitles[HIGHLIGHT_COMMAND];
/** A press of a shortcut in the document, where `Mod` is ⌘ on a Mac and Ctrl elsewhere. */
const shortcut = (editor: Editor, key: string, init: KeyboardEventInit = {}) => {
  const mac = /Mac/.test(navigator.platform);
  press(editor.view.contentDOM, key, { ctrlKey: !mac, metaKey: mac, ...init });
};

describe('the Highlight command', () => {
  it('is for the Format menu, right after Add Comment, with its key', () => {
    expect(HIGHLIGHT_COMMAND).toBe('highlight.toggle');
    const { editor } = mount(plain);
    expect(command(editor)).toMatchObject({
      id: 'highlight.toggle',
      shortcut: 'Mod-Shift-h',
      menu: 'format',
      group: 'comment',
    });
    // Right after Add Comment, in the group that Add Comment is in.
    const ids = editor.commands.list().map(({ id }) => id);
    expect(ids.indexOf('highlight.toggle')).toBe(ids.indexOf('comment.add') + 1);
    expect(editor.commands.list().find(({ id }) => id === 'comment.add')?.group).toBe('comment');
    // Not disabled in Raw, or its key would not say why it does nothing there.
    expect('isEnabled' in command(editor)!).toBe(false);
  });

  it('goes with the review interface', () => {
    const { editor, review } = mount(plain);
    review.destroy();
    expect(editor.commands.list().map(({ id }) => id)).not.toContain('highlight.toggle');
  });

  it('makes a highlight on the selection, as you', () => {
    const { editor } = mount(plain);
    select(editor, 'importer');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const [mark] = highlights(editor);
    expect(highlights(editor)).toHaveLength(1);
    expect(doc(editor)).toContain(`The <!--hl ${mark!.id}-->importer<!--/${mark!.id}--> ships`);
    const { ledger } = editor.getParsed();
    expect(ledger.marks[mark!.id]).toMatchObject({ by: 'mira' });
    expect(ledger.people.map((person) => person.handle)).toContain('mira');
    // Nothing but the highlight: no thread, and no change to the text.
    expect(ledger.comments).toEqual([]);
    expect(editor.getUiState().changes).toEqual([]);
    // The selection is still on the words.
    expect(selected(editor)).toBe('importer');
  });

  it('makes a highlight on the word under the caret when nothing is selected', () => {
    for (const offset of [0, 3, 8]) {
      const { editor } = mount(plain);
      caretAt(editor, place(editor, 'importer').from + offset);
      expect(editor.commands.run(HIGHLIGHT_COMMAND), `offset ${offset}`).toBe(true);
      const [mark] = highlights(editor);
      expect(doc(editor), `offset ${offset}`).toContain(
        `<!--hl ${mark!.id}-->importer<!--/${mark!.id}-->`,
      );
      expect(selected(editor)).toBe('');
      unmountAll();
    }
  });

  it('leaves the underscores of `_emphasis_` out of the word under the caret', () => {
    // CodeMirror's word holds them. At the end of the body the closer would have no place after
    // the closing `_` (format §3.1), and the highlight is on the word that the emphasis is on.
    for (const [body, word] of [
      ['This is _important_', 'important'],
      ['This is _important_ now.', 'important'],
      ['This is __important__', 'important'],
      ['Use snake_case_', 'snake_case'],
      ['A _snake_case_ here', 'snake_case'],
    ] as const) {
      for (const offset of [0, 3, word.length]) {
        const { editor, notices } = mount(file(body, PEOPLE));
        caretAt(editor, place(editor, word).from + Math.min(offset, word.length));
        expect(editor.commands.run(HIGHLIGHT_COMMAND), `${body} at ${offset}`).toBe(true);
        const [mark] = highlights(editor);
        expect(doc(editor), `${body} at ${offset}`).toContain(
          `<!--hl ${mark!.id}-->${word}<!--/${mark!.id}-->`,
        );
        // The underscores are outside it, as they were.
        expect(doc(editor).replace(/<!--\/?(?:hl )?[a-z0-9]{4}-->/g, '')).toContain(body);
        expect(notices, `${body} at ${offset}`).toEqual([]);
        unmountAll();
      }
    }
    // `*emphasis*` has no underscores to leave out, and is on the word as before.
    const { editor } = mount(file('This is *important*', PEOPLE));
    caretAt(editor, place(editor, 'important').from + 2);
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const [mark] = highlights(editor);
    expect(doc(editor)).toContain(`*<!--hl ${mark!.id}-->important<!--/${mark!.id}-->*`);
  });

  it('says there is no text when the word under the caret is nothing but underscores', () => {
    const { editor, notices } = mount(file('One ___ two.', PEOPLE));
    caretAt(editor, place(editor, '___').from + 1);
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(notices).toEqual(['Select some text to highlight.']);
    expect(highlights(editor)).toEqual([]);
  });

  it('finds the word at a caret beside a hidden marker, at either end of it', () => {
    const commented = file('The <!--cmt c2dk-->importer<!--/c2dk--> ships.', [
      ...PEOPLE,
      'comments:',
      ...thread('c2dk', 'bo', 'Which?'),
    ]);
    // On screen the caret is at the start or the end of the word, though it is in front of the
    // opener or after the closer.
    for (const marker of ['<!--cmt c2dk-->', '<!--/c2dk-->']) {
      const { editor } = mount(commented);
      const { from, to } = place(editor, marker);
      caretAt(editor, marker.startsWith('<!--cmt') ? from : to);
      expect(editor.commands.run(HIGHLIGHT_COMMAND), marker).toBe(true);
      const [mark] = highlights(editor);
      expect(doc(editor), marker).toContain(`<!--hl ${mark!.id}-->importer<!--/${mark!.id}-->`);
      unmountAll();
    }
  });

  it('makes the highlight from the key, ⇧⌘H', () => {
    const { editor } = mount(plain);
    select(editor, 'April');
    shortcut(editor, 'H', { shiftKey: true, keyCode: 72 });
    const [mark] = highlights(editor);
    expect(doc(editor)).toContain(`in <!--hl ${mark!.id}-->April<!--/${mark!.id}-->.`);
  });

  it('goes over a whole selection, across blocks, and ends where the body does', () => {
    const { editor } = mount(file('One two.\n\nThree four.', PEOPLE));
    select(editor, 'two.\n\nThree');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const [mark] = highlights(editor);
    expect(doc(editor)).toContain(
      `One <!--hl ${mark!.id}-->two.\n\nThree<!--/${mark!.id}--> four.`,
    );
    // Select all takes the hidden ledger too: the highlight ends in front of it.
    const all = mount(plain).editor;
    all.view.dispatch({ selection: { anchor: 0, head: all.view.state.doc.length } });
    expect(all.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const parsed = all.getParsed();
    const hl = parsed.marks.find((m) => m.kind === 'hl')!;
    expect(hl.segments[0]!.close!.to).toBeLessThanOrEqual(parsed.ledgerRange!.from);
    expect(parsed.warnings.map((w) => w.code)).toEqual([]);
  });

  it('says so when there is no text to highlight', () => {
    const { editor, notices } = mount(file('One  two.', PEOPLE));
    // Between two spaces: no selection, and no word under the caret.
    caretAt(editor, 4);
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(notices).toEqual(['Select some text to highlight.']);
    expect(doc(editor)).toBe(file('One  two.', PEOPLE));
    // The ledger's people are no text: a caret in the ledger, which is hidden, is no word either.
    expect(highlights(editor)).toEqual([]);
  });

  it('says so for a caret or a selection in a struck-through word, which reads as no text', () => {
    // The deleted words are in no view of the file, and a highlight on them alone has no text.
    const struck = file('The importer ships <!--del w2rf in April--> soon.', [
      ...PEOPLE,
      'marks:',
      '  w2rf: {by: bo, at: 2026-10-31T09:41Z}',
    ]);
    const { editor, notices } = mount(struck);
    caretAt(editor, place(editor, 'April').from + 2);
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    select(editor, 'in April');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(notices).toEqual(['Select some text to highlight.', 'Select some text to highlight.']);
    expect(doc(editor)).toBe(struck);
    // With the word beside it in the selection, the highlight holds the deletion.
    select(editor, 'ships <!--del w2rf in April-->');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const [mark] = highlights(editor);
    expect(doc(editor)).toContain(
      `<!--hl ${mark!.id}-->ships <!--del w2rf in April--><!--/${mark!.id}-->`,
    );
    expect(notices).toHaveLength(2);
  });

  it('says the format’s words when it refuses, and changes nothing', () => {
    const code = file('Use `code` here.', PEOPLE);
    const { editor, notices } = mount(code);
    select(editor, 'od');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("A highlight can't be made inside code");
    expect(notices[0]).not.toMatch(/comment can't/);
    expect(doc(editor)).toBe(code);
    // The whole code span is fine.
    select(editor, '`code`');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(notices).toHaveLength(1);
  });

  it('takes no highlight in Raw, to make or to remove, and says so', () => {
    for (const text of [plain, marked]) {
      const { editor, notices } = mount(text);
      editor.setViewMode('raw');
      select(editor, 'importer');
      expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
      shortcut(editor, 'H', { shiftKey: true, keyCode: 72 });
      expect(notices).toHaveLength(2);
      expect(notices[0]).toBe(
        "A highlight can't be made or removed in Raw. Switch to Redlines to do either.",
      );
      expect(doc(editor)).toBe(text);
      expect(editor.getUiState().view).toBe('raw');
      // In Raw the command is a plain "Highlight", with no check: nothing it does is on offer.
      expect(titleOf(editor)).toBe('Highlight');
      expect(activeIds(editor)).not.toContain(HIGHLIGHT_COMMAND);
    }
  });

  it('removes the highlight that the caret is in, and the text stays', () => {
    const { editor } = mount(marked, { real: true });
    caretAt(editor, place(editor, 'importer').from + 3);
    expect(titleOf(editor)).toBe('Remove Highlight');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(doc(editor)).toContain('The importer ships in <!--hl w8nn-->April<!--/w8nn-->.');
    expect(doc(editor)).not.toContain('h4kz');
    expect(highlights(editor).map((mark) => mark.id)).toEqual(['w8nn']);
    expect(editor.getParsed().ledger.marks).toHaveProperty('w8nn');
    expect(editor.getParsed().ledger.marks).not.toHaveProperty('h4kz');
    expect(titleOf(editor)).toBe('Highlight');
  });

  it('removes the highlights that a selection is in or overlaps, all in one step to undo', () => {
    const { editor } = mount(marked, { real: true });
    // From inside the first to inside the second.
    const from = place(editor, 'porter').from;
    const to = place(editor, 'Apr').to;
    editor.view.dispatch({ selection: { anchor: from, head: to } });
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(highlights(editor)).toEqual([]);
    expect(editor.getParsed().ledger.marks).toEqual({});
    expect(editor.getDoc()).toContain('The importer ships in April.');
    // One step brings both back.
    expect(editor.undo()).toBe(true);
    expect(doc(editor)).toBe(marked);
    // A selection of the whole line that holds one, which it overlaps, is no highlight on the line.
    editor.view.dispatch({ selection: { anchor: 0, head: place(editor, 'ships').to } });
    expect(titleOf(editor)).toBe('Remove Highlight');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(highlights(editor).map((mark) => mark.id)).toEqual(['w8nn']);
  });

  it('toggles: a second press takes the first one back, on a selection and on a caret', () => {
    const { editor } = mount(plain, { real: true });
    select(editor, 'importer');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(highlights(editor)).toHaveLength(1);
    expect(titleOf(editor)).toBe('Remove Highlight');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(highlights(editor)).toEqual([]);
    expect(doc(editor)).toContain('The importer ships in April.');
    expect(doc(editor)).not.toContain('<!--hl');
    // On a caret anywhere in the word, at either end too: the caret is beside hidden markers.
    for (const offset of [0, 4, 8]) {
      caretAt(editor, place(editor, 'importer').from + offset);
      expect(editor.commands.run(HIGHLIGHT_COMMAND), `on ${offset}`).toBe(true);
      expect(highlights(editor), `on ${offset}`).toHaveLength(1);
      expect(editor.commands.run(HIGHLIGHT_COMMAND), `off ${offset}`).toBe(true);
      expect(highlights(editor), `off ${offset}`).toEqual([]);
    }
  });

  it('is one step to undo, named Highlight, and redo makes it again', () => {
    const { editor } = mount(plain);
    select(editor, 'importer');
    editor.commands.run(HIGHLIGHT_COMMAND);
    const made = doc(editor);
    expect(editor.getUiState().undo).toBe('Highlight');
    expect(editor.undo()).toBe(true);
    expect(doc(editor)).toBe(plain);
    expect(editor.getUiState().redo).toBe('Highlight');
    expect(editor.redo()).toBe(true);
    expect(doc(editor)).toBe(made);
  });

  it('is no typing: with Track Changes on it makes no tracked change', () => {
    const { editor } = mount(plain);
    editor.setTracking(true);
    select(editor, 'importer');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    const parsed = editor.getParsed();
    expect(parsed.marks.map((mark) => mark.kind)).toEqual(['hl']);
    expect(editor.getUiState().changes).toEqual([]);
    expect(doc(editor)).not.toContain('<!--ins');
  });

  it('keeps the file’s own line breaks', () => {
    const crlf = plain.replaceAll('\n', '\r\n');
    const { editor } = mount(crlf);
    select(editor, 'importer');
    editor.commands.run(HIGHLIGHT_COMMAND);
    expect(editor.getDoc().replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(editor.getDoc()).toContain('<!--hl ');
  });
});

describe('the Highlight command and the view', () => {
  it.each(['simple', 'redlines'] as const)(
    'switches a document shown Clean to the markup view, %s, so that the highlight shows',
    (markupView) => {
      const { editor } = mount(plain, { markupView });
      expect(editor.getUiState().view).toBe('clean');
      select(editor, 'importer');
      expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
      expect(editor.getUiState().view).toBe(markupView);
      expect(highlights(editor)).toHaveLength(1);
    },
  );

  it.each(['simple', 'redlines'] as const)(
    'switches a document with redlines that is shown Clean too, %s, though it gains none',
    (markupView) => {
      // The editor switches a document that gains its first redline; this one has some already.
      const { editor } = mount(marked, { markupView });
      editor.setViewMode('clean');
      expect(editor.getUiState().view).toBe('clean');
      select(editor, 'ships');
      expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
      expect(editor.getUiState().view).toBe(markupView);
      expect(highlights(editor)).toHaveLength(3);
    },
  );

  it('leaves Simple and Redlines as they are', () => {
    for (const view of ['simple', 'redlines'] as const) {
      const { editor } = mount(plain);
      editor.setViewMode(view);
      select(editor, 'importer');
      editor.commands.run(HIGHLIGHT_COMMAND);
      expect(editor.getUiState().view).toBe(view);
      unmountAll();
    }
  });

  it('switches to the markup view for a removal too, where the highlight was out of sight', () => {
    const { editor } = mount(marked, { real: true });
    editor.setViewMode('clean');
    caretAt(editor, place(editor, 'importer').from + 2);
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(true);
    expect(editor.getUiState().view).toBe('redlines');
    expect(highlights(editor).map((mark) => mark.id)).toEqual(['w8nn']);
  });

  it('leaves a document shown Clean as it was when the highlight is refused', () => {
    const { editor, notices } = mount(file('Use `code` here.', PEOPLE));
    select(editor, 'od');
    expect(editor.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(editor.getUiState().view).toBe('clean');
    expect(notices).toHaveLength(1);
    const { editor: none, notices: said } = mount(file('One  two.', PEOPLE));
    caretAt(none, 4);
    expect(none.commands.run(HIGHLIGHT_COMMAND)).toBe(false);
    expect(none.getUiState().view).toBe('clean');
    expect(said).toHaveLength(1);
  });
});

describe('what the Format menu and the palette show of Highlight', () => {
  it('has the title of a command that works on a state with none of the editor’s fields', () => {
    const bare = EditorState.create();
    expect(highlightsAt(bare)).toEqual([]);
    expect(highlightTitle(bare)).toBe('Highlight');
    const { editor } = mount(plain);
    // A menu asks for the title before there is a document (`baseTitle`).
    expect(typeof command(editor)!.title).toBe('function');
    expect(baseTitle(command(editor)!)).toBe('Highlight');
    expect(command(editor)!.isActive!(bare)).toBe(false);
  });

  it('is Remove Highlight, and on, while the caret or selection is in a highlight', () => {
    const { editor } = mount(marked);
    const word = place(editor, 'importer');
    const open = place(editor, '<!--hl h4kz-->');
    const close = place(editor, '<!--/h4kz-->');
    const status = () => [titleOf(editor), activeIds(editor).includes(HIGHLIGHT_COMMAND)];
    const IN = ['Remove Highlight', true];
    const OUT = ['Highlight', false];
    // Anywhere in the word, and beside the markers at its ends, which are hidden.
    for (const caret of [open.from, open.to, word.from + 3, close.from, close.to]) {
      caretAt(editor, caret);
      expect(status(), `caret at ${caret}`).toEqual(IN);
    }
    // Not before it, or after it.
    for (const caret of [0, open.from - 1, close.to + 1, doc(editor).length]) {
      caretAt(editor, caret);
      expect(status(), `caret at ${caret}`).toEqual(OUT);
    }
    // A selection that has some of its text, whether it starts in it, ends in it or holds it all.
    for (const [from, to] of [
      [word.from + 1, word.from + 3],
      [0, word.from + 2],
      [word.to - 2, close.to + 4],
      [0, doc(editor).length],
    ] as const) {
      editor.view.dispatch({ selection: { anchor: from, head: to } });
      expect(status(), `selection ${from}-${to}`).toEqual(IN);
    }
    // But not one that only ends where it starts, or starts where it ends.
    for (const [from, to] of [
      [0, open.from],
      [close.to, close.to + 7],
    ] as const) {
      editor.view.dispatch({ selection: { anchor: from, head: to } });
      expect(status(), `selection ${from}-${to}`).toEqual(OUT);
    }
  });

  it('is on in the highlight of a block, whose opener has a line of its own', () => {
    const body = 'Para one.\n\n<!--hl h4kz-->\n\nThe importer ships.<!--/h4kz-->\n\nLast.';
    const { editor } = mount(
      file(body, ['marks:', '  h4kz: {by: bo, at: 2026-10-31T09:41Z}', ...PEOPLE]),
    );
    caretAt(editor, place(editor, 'The importer').from + 4);
    expect(titleOf(editor)).toBe('Remove Highlight');
    caretAt(editor, place(editor, 'Last.').from + 2);
    expect(titleOf(editor)).toBe('Highlight');
    caretAt(editor, place(editor, 'Para').from + 2);
    expect(titleOf(editor)).toBe('Highlight');
  });

  it('is not on for a comment, or for a change', () => {
    const text = file(
      'The <!--cmt c2dk-->importer<!--/c2dk--> ships <!--ins k3x9-->soon<!--/k3x9-->.',
      [
        ...PEOPLE,
        'marks:',
        '  k3x9: {by: bo, at: 2026-10-31T09:41Z}',
        'comments:',
        ...thread('c2dk', 'bo', 'Which?'),
      ],
    );
    const { editor } = mount(text);
    for (const word of ['importer', 'soon']) {
      caretAt(editor, place(editor, word).from + 2);
      expect(titleOf(editor), word).toBe('Highlight');
      expect(activeIds(editor), word).not.toContain(HIGHLIGHT_COMMAND);
    }
  });

  it('reads the highlights of a parse once, and of the state it is asked about', () => {
    const { editor } = mount(marked);
    const state = editor.view.state;
    expect(highlightsAt(state)).toEqual(highlightsAt(state));
    expect(parse(doc(editor)).marks.filter((mark) => mark.kind === 'hl')).toHaveLength(2);
  });
});
