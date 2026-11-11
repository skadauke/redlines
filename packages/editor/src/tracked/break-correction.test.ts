// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redo, undo } from '../history/index.ts';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { editSourceFacet } from './typing.ts';

// A word ended with Return: the editor handles the key itself, so WebKit never sees the word end,
// and the editor asks the host for the correction of the word before the break. The break goes in
// at once; the answer, whenever it comes, is made as WebKit's own corrections are (corrections.ts)
// if the word is still exactly there.

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const NOW = new Date('2026-11-01T10:00:30Z');
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

/** Random bytes that spell out the given ids, for new marks. */
function randomIds(...ids: string[]): (n: number) => Uint8Array {
  const bytes = ids.flatMap((id) => [...id].map((c, i) => (i === 0 ? FIRST : REST).indexOf(c)));
  let at = 0;
  return (n) => {
    const chunk = Uint8Array.from(bytes.slice(at, at + n));
    at += n;
    return chunk;
  };
}

/** A host's answer, held until the test gives it. */
interface Question {
  word: string;
  before: string;
  answer(text: string | null): Promise<void>;
  fail(): Promise<void>;
}

/** An editor for Ada with a host whose answers the test gives, in the order it was asked. */
function load(doc: string, options: Partial<EditorOptions> = {}) {
  const questions: Question[] = [];
  const correctWord = vi.fn(
    (word: string, before: string) =>
      new Promise<string | null>((resolve, reject) => {
        questions.push({
          word,
          before,
          answer: async (text) => {
            resolve(text);
            await settled();
          },
          fail: async () => {
            reject(new Error('no checker'));
            await settled();
          },
        });
      }),
  );
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    typing: { spellCheck: true, smartPunctuation: false, closePairs: false },
    correctWord,
    ...options,
    extensions: [editSourceFacet.of({ now: () => NOW, random: randomIds('b2b2', 'c3c3', 'd4d4') })],
  });
  open.push(editor);
  return { editor, questions, correctWord };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const docText = (editor: Editor) => editor.view.state.doc.toString();
const body = (editor: Editor) => {
  const { text, ledgerRange } = editor.getParsed();
  return ledgerRange ? text.slice(0, ledgerRange.from).trimEnd() : text;
};

/** A key's keydown on the content, through the editor's keymaps, as the browser sends it. */
function press(editor: Editor, key: string, modifiers: KeyboardEventInit = {}): void {
  editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

/** Types text as the browser does: the transaction CodeMirror makes of each character. */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    editor.view.dispatch(editor.view.state.replaceSelection(char), { userEvent: 'input.type' });
  }
}

const atEnd = (editor: Editor) =>
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });

describe('a word ended with Return', () => {
  it('asks for the word before the break, with the block before it, and breaks at once', () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    expect(questions.map(({ word, before }) => [word, before])).toEqual([['teh', 'Hello ']]);
    expect(docText(editor)).toBe('Hello teh\n\n');
  });

  it('changes the text of your own insertion, which stays one', async () => {
    const { editor, questions } = load('Hello ', { tracking: true });
    atEnd(editor);
    type(editor, 'teh');
    press(editor, 'Enter');
    expect(questions).toHaveLength(1);
    await questions[0]!.answer('the');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the<!--/b2b2-->');
  });

  it("is one tracked change of only the letters that differ in someone else's text", async () => {
    const { editor, questions } = load('Hello teh', { tracking: true });
    atEnd(editor);
    press(editor, 'Enter');
    await questions[0]!.answer('the');
    const text = body(editor);
    // Only "eh" turns into "he": the t stays as it was, in one substitution.
    expect(text).toBe('Hello t<!--sub b2b2 eh-->he<!--/b2b2-->');
  });

  it('is a plain edit with Track Changes off', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello the\n\n');
  });

  it('is its own step: Undo takes it back first, then the Return', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello the\n\n');
    expect(undo(editor.view)).toBe(true);
    expect(docText(editor)).toBe('Hello teh\n\n');
    expect(undo(editor.view)).toBe(true);
    expect(docText(editor)).toBe('Hello teh');
  });

  it('is its own step with Track Changes on too', async () => {
    const { editor, questions } = load('Hello ', { tracking: true });
    atEnd(editor);
    type(editor, 'teh');
    const beforeBreak = docText(editor);
    press(editor, 'Enter');
    const withBreak = body(editor);
    await questions[0]!.answer('the');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->the<!--/b2b2-->');
    expect(undo(editor.view)).toBe(true);
    expect(body(editor)).toBe(withBreak);
    expect(withBreak).toBe('Hello <!--ins b2b2-->teh<!--/b2b2-->');
    expect(undo(editor.view)).toBe(true);
    expect(docText(editor)).toBe(beforeBreak);
  });

  it('drops an answer that comes after the Return was undone, and the Return can be redone', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    expect(undo(editor.view)).toBe(true);
    expect(docText(editor)).toBe('Hello teh');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello teh');
    expect(redo(editor.view)).toBe(true);
    expect(docText(editor)).toBe('Hello teh\n\n');
  });

  it('drops an answer that comes after Backspace took the Return back', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    press(editor, 'Backspace');
    const before = docText(editor);
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe(before);
  });

  it('keeps the caret where the Return put it', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    const caret = editor.view.state.selection.main.head;
    await questions[0]!.answer('the');
    expect(editor.view.state.selection.main.head).toBe(caret);
  });

  describe('in a table cell, where the break is a <br>', () => {
    const TABLE = '| Fruit | Note |\n| ----- | ---- |\n| Plums | Hello teh | x |\n';

    it('asks for the word and corrects it, as in a paragraph', async () => {
      const { editor, questions } = load(TABLE, { tracking: false });
      editor.view.dispatch({ selection: { anchor: TABLE.indexOf('teh') + 3 } });
      press(editor, 'Enter');
      expect(docText(editor)).toContain('Hello teh<br> |');
      expect(questions.map(({ word, before }) => [word, before])).toEqual([['teh', 'Hello ']]);
      await questions[0]!.answer('the');
      expect(docText(editor)).toContain('Hello the<br> |');
    });

    it('does the same after Shift-Return, with Track Changes on', async () => {
      const { editor, questions } = load(TABLE, { tracking: true });
      editor.view.dispatch({ selection: { anchor: TABLE.indexOf('teh') + 3 } });
      press(editor, 'Enter', { shiftKey: true });
      expect(questions).toHaveLength(1);
      await questions[0]!.answer('the');
      expect(docText(editor)).toContain('t<!--sub');
      expect(docText(editor)).toContain('<br>');
    });
  });

  it('corrects after Shift-Return too', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter', { shiftKey: true });
    expect(questions).toHaveLength(1);
    expect(docText(editor)).not.toBe('Hello teh');
    await questions[0]!.answer('the');
    // The empty line Shift-Return opens at the end: its hard break and its no-break space.
    expect(docText(editor)).toBe('Hello the\\\n\u00a0');
    expect(editor.view.state.selection.main.head).toBe('Hello the\\\n'.length);
  });

  it('corrects after Shift-Return at the end with Track Changes on, and in the middle', async () => {
    for (const [doc, at] of [
      ['Hello teh', 'Hello teh'.length],
      ['Hello teh there', 'Hello teh'.length],
    ] as const) {
      const { editor, questions } = load(doc, { tracking: true });
      editor.view.dispatch({ selection: { anchor: at } });
      press(editor, 'Enter', { shiftKey: true });
      expect(questions).toHaveLength(1);
      await questions[0]!.answer('the');
      // A tracked correction of the word, whose break stays after it.
      expect(docText(editor)).toMatch(/Hello t<!--sub \w+ eh-->he<!--\/\w+-->/);
    }
  });

  it('applies the answer after the person typed on, mapped through what they typed', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    type(editor, 'Next');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello the\n\nNext');
  });

  it('applies the answer after text was added before the word', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 0, insert: 'Oh, ' }, userEvent: 'input.type' });
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Oh, Hello the\n\n');
  });

  it('drops the answer when the word was changed before it came', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 9, insert: 'x' }, userEvent: 'input.type' });
    const before = docText(editor);
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe(before);
  });

  it('drops the answer when the word was deleted before it came', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 6, to: 9 }, userEvent: 'delete' });
    const before = docText(editor);
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe(before);
  });

  it('drops the answer when the space before the word was deleted before it came', async () => {
    const { editor, questions } = load('x teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 1, to: 2 }, userEvent: 'delete' });
    expect(docText(editor)).toBe('xteh\n\n');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('xteh\n\n');
  });

  it('drops the answer when text was joined to the end of the word', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 9, insert: 'x' }, userEvent: 'input.type' });
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello tehx\n\n');
  });

  it('drops the answer when the editor is in Raw by then', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.setViewMode('raw');
    const before = docText(editor);
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe(before);
  });

  it('drops an answer of nothing, and one that failed', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    await questions[0]!.answer(null);
    expect(docText(editor)).toBe('Hello teh\n\n');
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 0, insert: 'x ' } });
    type(editor, 'wrd');
    press(editor, 'Enter');
    await questions[1]!.fail();
    expect(docText(editor)).toContain('wrd');
  });

  it('drops the answer once the editor is gone', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.destroy();
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello teh\n\n');
  });

  it('asks about a word with an apostrophe inside', () => {
    const { editor, questions } = load("Say dont't", { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    expect(questions.map((q) => q.word)).toEqual(["dont't"]);
  });
});

/** A document with a ledger that gives each mark's author. */
function withLedger(text: string, marks: Record<string, string>): string {
  const entries = Object.entries(marks).map(
    ([id, by]) => `  ${id}: {by: ${by}, at: 2026-10-31T09:30Z}\n`,
  );
  return `${text}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries.join('')}-->\n`;
}

describe('answers that come late or out of order', () => {
  it('apply each to its own word, whichever comes first', async () => {
    for (const reversed of [false, true]) {
      const { editor, questions } = load('One teh', { tracking: false });
      atEnd(editor);
      press(editor, 'Enter');
      type(editor, 'and wrd');
      press(editor, 'Enter');
      expect(questions.map((q) => q.word)).toEqual(['teh', 'wrd']);
      const order = reversed ? [1, 0] : [0, 1];
      const answers = ['the', 'word'];
      for (const i of order) await questions[i]!.answer(answers[i]!);
      expect(docText(editor)).toBe('One the\n\nand word\n\n');
    }
  });

  it('drop the first and apply the second when only the first word changed', async () => {
    const { editor, questions } = load('One teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    type(editor, 'and wrd');
    press(editor, 'Enter');
    editor.view.dispatch({ changes: { from: 7, insert: 'x' }, userEvent: 'input.type' });
    await questions[1]!.answer('word');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('One tehx\n\nand word\n\n');
  });

  it('drop once the editor went to Raw and back, which leaves no break', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.setViewMode('raw');
    editor.setViewMode('clean');
    expect(docText(editor)).toBe('Hello teh');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello teh');
  });

  it('drop when a file read from disk replaced the document', async () => {
    const { editor, questions } = load('Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    editor.setDoc('Hello teh');
    await questions[0]!.answer('the');
    expect(docText(editor)).toBe('Hello teh');
  });
});

describe("a word beside another person's changes", () => {
  it('after their pending deletion is asked about as the newest text has it', async () => {
    const doc = withLedger('Hello <!--del f5f5 x-->teh', { f5f5: 'bo' });
    const { editor, questions } = load(doc, { tracking: false, view: 'clean' });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('teh') + 3 } });
    press(editor, 'Enter');
    expect(questions.map((q) => [q.word, q.before])).toEqual([['teh', 'Hello ']]);
    await questions[0]!.answer('the');
    expect(body(editor)).toContain('Hello <!--del f5f5 x-->the');
  });

  it('joined to their deleted text by it is asked about as one word, as the newest text reads', () => {
    const doc = withLedger('Say foo<!--del f5f5 bar-->teh', { f5f5: 'bo' });
    const { editor, questions } = load(doc, { tracking: false, view: 'clean' });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('teh') + 3 } });
    press(editor, 'Enter');
    expect(questions.map((q) => [q.word, q.before])).toEqual([['footeh', 'Say ']]);
  });

  it('inside their insertion is corrected there, as a change of your own', async () => {
    const doc = withLedger('Hello <!--ins f5f5-->big teh<!--/f5f5--> day', { f5f5: 'bo' });
    const { editor, questions } = load(doc, { tracking: true });
    editor.view.dispatch({ selection: { anchor: doc.indexOf('teh') + 3 } });
    press(editor, 'Enter');
    expect(questions.map((q) => [q.word, q.before])).toEqual([['teh', 'Hello big ']]);
    await questions[0]!.answer('the');
    // One substitution of only "eh" inside their insertion, which the break then splits.
    expect(body(editor)).toContain('big t<!--sub c3c3 eh-->he<!--/c3c3--><!--/f5f5-->');
  });
});

describe('the text sent to the host', () => {
  it('is cut between code points, never inside an emoji', () => {
    // 301 UTF-16 units (an emoji is two) of context in front of the word: the cut at 300 falls inside the first one.
    const { editor, questions } = load(`\u{1f600}${'a'.repeat(298)} teh`, { tracking: false });
    atEnd(editor);
    press(editor, 'Enter');
    const { before } = questions[0]!;
    expect(before).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
    );
    expect(before.endsWith('a ')).toBe(true);
    expect(before.length).toBeLessThanOrEqual(300);
  });
});

const HEADING = '# Hello teh now';
const IN_HEADING = HEADING.indexOf('teh') + 3;

describe('a Return that asks nothing', () => {
  const asks = (doc: string, caret?: number, view?: EditorOptions['view']) => {
    const { editor, correctWord } = load(doc, { tracking: false, ...(view ? { view } : {}) });
    editor.view.dispatch({ selection: { anchor: caret ?? editor.view.state.doc.length } });
    press(editor, 'Enter');
    return correctWord.mock.calls.length;
  };

  it('after a number, a closing parenthesis, punctuation or a space', () => {
    expect(asks('Chapter 12')).toBe(0);
    expect(asks('(teh)')).toBe(0);
    expect(asks('Hello teh.')).toBe(0);
    expect(asks('Hello teh ')).toBe(0);
    expect(asks('')).toBe(0);
  });

  it('in the middle of a word, or after a word with a digit in it', () => {
    expect(asks('Hello teh there', 8)).toBe(0);
    expect(asks('abc123def')).toBe(0);
  });

  it('in inline code, a code block, a URL, front matter or an HTML comment', () => {
    expect(asks('Say `teh`', 8)).toBe(0);
    expect(asks('```\nteh\n```', 7)).toBe(0);
    expect(asks('    teh')).toBe(0);
    expect(asks('See https://example.com/teh')).toBe(0);
    expect(asks('---\ntitle: teh\n---\n\nBody', 14)).toBe(0);
    expect(asks('Hello <!-- teh -->', 14)).toBe(0);
  });

  it('in Raw', () => {
    expect(asks('Hello teh', undefined, 'raw')).toBe(0);
  });

  it('with a selection', () => {
    const { editor, correctWord } = load('Hello teh', { tracking: false });
    editor.view.dispatch({ selection: { anchor: 6, head: 9 } });
    press(editor, 'Enter');
    expect(correctWord).not.toHaveBeenCalled();
  });

  it('with spell check off', () => {
    const { editor, correctWord } = load('Hello teh', {
      tracking: false,
      typing: { spellCheck: false, smartPunctuation: false, closePairs: false },
    });
    atEnd(editor);
    press(editor, 'Enter');
    expect(correctWord).not.toHaveBeenCalled();
  });

  it('with no host to ask', () => {
    const { editor } = load('Hello teh', { tracking: false, correctWord: undefined });
    atEnd(editor);
    press(editor, 'Enter');
    expect(docText(editor)).toBe('Hello teh\n\n');
  });

  it('on Tab, the arrows, a click or any ⌘ key', () => {
    const { editor, correctWord } = load('- Hello teh', { tracking: false });
    atEnd(editor);
    press(editor, 'Tab');
    press(editor, 'ArrowLeft');
    press(editor, 'ArrowRight');
    press(editor, 'ArrowUp');
    press(editor, 'ArrowDown');
    editor.view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    press(editor, 'ArrowRight', { metaKey: true });
    press(editor, 'Enter', { metaKey: true });
    press(editor, 'Backspace', { metaKey: true });
    expect(correctWord).not.toHaveBeenCalled();
  });

  it('for a break after an Enter that made none, however the next transaction comes', () => {
    // Shift-Return in a heading is refused: the key makes no break, only a notice.
    const { editor, correctWord } = load(HEADING, { tracking: false });
    editor.view.dispatch({ selection: { anchor: IN_HEADING } });
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(docText(editor)).toBe(HEADING);
    expect(correctWord).not.toHaveBeenCalled();
    // The key's lost key up, and then a break from anywhere, or a pasted line break.
    editor.view.dispatch({
      changes: { from: IN_HEADING, insert: '\n\n' },
      userEvent: 'input.break',
    });
    expect(correctWord).not.toHaveBeenCalled();
  });

  it('for a pasted line break after an Enter that made none', () => {
    const { editor, correctWord } = load(HEADING, { tracking: false });
    editor.view.dispatch({ selection: { anchor: IN_HEADING } });
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.view.dispatch({
      changes: { from: IN_HEADING, insert: '\n' },
      userEvent: 'input.paste',
    });
    expect(correctWord).not.toHaveBeenCalled();
  });

  it('for a break that no key made', () => {
    const { editor, correctWord } = load('Hello teh', { tracking: false });
    atEnd(editor);
    editor.view.dispatch({
      changes: { from: 9, insert: '\n\n' },
      selection: { anchor: 11 },
      userEvent: 'input.break',
    });
    expect(correctWord).not.toHaveBeenCalled();
  });
});
