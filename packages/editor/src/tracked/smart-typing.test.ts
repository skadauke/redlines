// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { editSourceFacet } from './typing.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const NOW = new Date('2026-11-01T10:00:30Z');
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const ALL = { spellCheck: true, smartPunctuation: true, closePairs: true };
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

function load(doc: string, options: Partial<EditorOptions> & { ids?: string[] } = {}): Editor {
  const { ids = ['b2b2', 'c3c3'], ...rest } = options;
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    typing: ALL,
    ...rest,
    extensions: [editSourceFacet.of({ now: () => NOW, random: randomIds(...ids) })],
  });
  open.push(editor);
  return editor;
}

/** Types a key as the browser does: the input handlers first, and the text as it is otherwise. */
function key(editor: Editor, text: string): void {
  const { view } = editor;
  const { from, to } = view.state.selection.main;
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, () => view.state.update({})));
  if (!handled) {
    view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.type' });
  }
}

const typeAll = (editor: Editor, text: string) => [...text].forEach((c) => key(editor, c));
const end = (editor: Editor) =>
  editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
/** The document without its ledger. */
const body = (editor: Editor) => {
  const { text, ledgerRange } = editor.getParsed();
  return ledgerRange ? text.slice(0, ledgerRange.from).trimEnd() : text;
};
const head = (editor: Editor) => editor.view.state.selection.main.head;

describe('closing pairs', () => {
  it('closes a pair as one tracked insertion with tracking on', () => {
    const editor = load('Hello ', { tracking: true });
    end(editor);
    key(editor, '(');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->()<!--/b2b2-->');
    expect(head(editor)).toBe('Hello <!--ins b2b2-->('.length);
    // Typing inside extends the same insertion, and the closer is typed over, not doubled.
    typeAll(editor, 'a)');
    expect(body(editor)).toBe('Hello <!--ins b2b2-->(a)<!--/b2b2-->');
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['b2b2']);
  });

  it('closes a pair in plain text with tracking off, and types over the closer', () => {
    const editor = load('Hello ');
    end(editor);
    typeAll(editor, '[x]');
    expect(editor.getDoc()).toBe('Hello [x]');
    expect(head(editor)).toBe(9);
  });

  it('does not close a pair before a word, or when the person selected text', () => {
    const editor = load('Hello world');
    editor.view.dispatch({ selection: { anchor: 6 } });
    key(editor, '(');
    expect(editor.getDoc()).toBe('Hello (world');
    editor.view.dispatch({ selection: { anchor: 7, head: 12 } });
    key(editor, '[');
    expect(editor.getDoc()).toBe('Hello ([');
  });

  it('closes backticks, but not inside a word, and a fence leaves no stray one', () => {
    const editor = load('snake');
    end(editor);
    key(editor, '`');
    expect(editor.getDoc()).toBe('snake`');
    const fence = load('');
    typeAll(fence, '```');
    // The third backtick on a line of its own closes the fence (typed syntax), with no stray one.
    expect(fence.getDoc()).toBe('```\n\n```');
  });

  it('does nothing in code or in Raw', () => {
    const code = load('`a b`\n');
    code.view.dispatch({ selection: { anchor: 3 } });
    key(code, '(');
    expect(code.getDoc()).toBe('`a (b`\n');
    const fenced = load('```\nx\n```\n');
    fenced.view.dispatch({ selection: { anchor: 4 } });
    key(fenced, '"');
    expect(fenced.getDoc()).toBe('```\n"x\n```\n');
    const raw = load('Hello ', { view: 'raw' });
    end(raw);
    key(raw, '(');
    expect(raw.getDoc()).toBe('Hello (');
  });
});

describe('where the characters mean themselves', () => {
  it('leaves YAML front matter, the ledger and HTML comments alone', () => {
    const front = load('---\ntitle: x\n---\n\nBody\n');
    front.view.dispatch({ selection: { anchor: 11 } });
    typeAll(front, '"a"--(');
    expect(front.getDoc()).toBe('---\ntitle: "a"--(x\n---\n\nBody\n');
    // After the front matter, typing helps again.
    end(front);
    typeAll(front, '"b"');
    expect(front.getDoc().endsWith('Body\n“b”')).toBe(true);

    const comment = load('<!-- note: \n');
    comment.view.dispatch({ selection: { anchor: 11 } });
    typeAll(comment, '"x"(');
    expect(comment.getDoc()).toBe('<!-- note: "x"(\n');
  });

  it('types over a closer past the marker of a tracked change, and lands after the closer', () => {
    const doc = 'x (a<!--ins b2b2-->b<!--/b2b2-->) y';
    const editor = load(doc);
    editor.view.dispatch({ selection: { anchor: doc.indexOf('<!--/b2b2-->') } });
    key(editor, ')');
    expect(editor.getDoc()).toBe(doc);
    expect(head(editor)).toBe(doc.indexOf(') y') + 1);
  });
});

describe('smart punctuation', () => {
  it('turns straight quotes curly through the normal input path', () => {
    const editor = load('Then ', { tracking: true });
    end(editor);
    typeAll(editor, 'he said "it\'s done" now');
    expect(body(editor)).toBe('Then <!--ins b2b2-->he said “it’s done” now<!--/b2b2-->');
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['b2b2']);
  });

  it('opens a quote after a space or a bracket, and single quotes the same way', () => {
    const editor = load('');
    typeAll(editor, '\'a\' ("b")');
    expect(editor.getDoc()).toBe('‘a’ (“b”)');
  });

  it('makes an em dash of two hyphens, but leaves a line that starts with them alone', () => {
    const editor = load('');
    typeAll(editor, 'wait--what');
    expect(editor.getDoc()).toBe('wait—what');
    const rule = load('');
    typeAll(rule, '---');
    expect(rule.getDoc()).toBe('---');
    const list = load('- item\n');
    end(list);
    typeAll(list, '- ');
    expect(list.getDoc()).toBe('- item\n- ');
  });

  it('records a dash typed with tracking on as a tracked insertion', () => {
    const editor = load('A ', { tracking: true });
    end(editor);
    typeAll(editor, 'b--c');
    expect(body(editor)).toBe('A <!--ins b2b2-->b—c<!--/b2b2-->');
    expect(Object.keys(editor.getParsed().ledger.marks)).toEqual(['b2b2']);
  });

  it('is off until typing is given, and off when asked', () => {
    const plain = load('', { typing: undefined });
    typeAll(plain, '"a" (');
    expect(plain.getDoc()).toBe('"a" (');
    const editor = load('');
    editor.setTyping({ ...ALL, smartPunctuation: false, closePairs: false });
    typeAll(editor, '"a" (');
    expect(editor.getDoc()).toBe('"a" (');
    editor.setTyping(ALL);
    typeAll(editor, '"');
    expect(editor.getDoc()).toBe('"a" (“');
  });
});

describe('typing options', () => {
  it('maps spell check to the content element, and keeps it after another document opens', () => {
    const editor = load('One');
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('true');
    editor.setTyping({ ...ALL, spellCheck: false });
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('false');
    editor.setDoc('Two');
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('false');
  });

  it('turns autocorrect on while spell check is on', () => {
    // WebKit corrects a word only while it checks spelling, and only where the element doesn't say
    // autocorrect="off". The correction is typing (corrections.ts).
    const editor = load('One');
    const autocorrect = () => editor.view.contentDOM.getAttribute('autocorrect');
    expect(autocorrect()).toBe('on');
    editor.setTyping({ ...ALL, spellCheck: false });
    expect(autocorrect()).toBe('off');
    editor.setTyping(ALL);
    expect(autocorrect()).toBe('on');
    editor.setViewMode('raw');
    expect(autocorrect()).toBe('off');
  });

  it('turns autocorrect off with the caret in code, a URL or front matter', () => {
    const doc = '---\ntitle: x\n---\n\nSee `code` at https://example.com/x.\n\n```\nfenced\n```\n';
    const editor = load(doc);
    const autocorrect = (at: number) => {
      editor.view.dispatch({ selection: { anchor: at } });
      return editor.view.contentDOM.getAttribute('autocorrect');
    };
    expect(autocorrect(doc.indexOf('title') + 2)).toBe('off');
    expect(autocorrect(doc.indexOf('code`') + 2)).toBe('off');
    expect(autocorrect(doc.indexOf('example'))).toBe('off');
    expect(autocorrect(doc.indexOf('fenced') + 2)).toBe('off');
    expect(autocorrect(doc.indexOf('See') + 2)).toBe('on');
    // Right after the code, typing is prose again.
    expect(autocorrect(doc.indexOf('` at') + 1)).toBe('on');
  });

  it('keeps spell check out of code, URLs and front matter, on what the preview draws', () => {
    const doc = '---\ntitle: x\n---\n\nSee `code` at https://example.com/x.\n\n```\nfenced\n```\n';
    const editor = load(doc);
    // Each element the spell check leaves alone is one the preview draws: no spans of its own.
    const unchecked = () =>
      [...editor.view.contentDOM.querySelectorAll('[spellcheck="false"]')].map((element) =>
        element.classList.contains('cm-line')
          ? `line ${editor.view.state.doc.lineAt(editor.view.posAtDOM(element, 0)).number} ` +
            [...element.classList].find((name) => /^rl-(codeblock|frontmatter)$/.test(name))
          : `${element.className} ${element.textContent}`,
      );
    expect(unchecked()).toEqual([
      'line 1 rl-frontmatter',
      'line 2 rl-frontmatter',
      'line 3 rl-frontmatter',
      'rl-code code',
      'rl-link https://example.com/x',
      'line 7 rl-codeblock',
      'line 8 rl-codeblock',
      'line 9 rl-codeblock',
    ]);
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('true');
    editor.setTyping({ ...ALL, spellCheck: false });
    expect(editor.view.contentDOM.getAttribute('spellcheck')).toBe('false');
  });

  it('records edits under the author set last', () => {
    const editor = load('Hello ', { tracking: true, typing: undefined });
    editor.setAuthor({ handle: 'grace', name: 'Grace Hopper' });
    end(editor);
    typeAll(editor, 'x');
    expect(editor.getParsed().ledger.marks['b2b2']?.by).toBe('grace');
    editor.setDoc('Again ');
    end(editor);
    editor.setTracking(true);
    typeAll(editor, 'y');
    expect(Object.values(editor.getParsed().ledger.marks).at(-1)?.by).toBe('grace');
  });
});
