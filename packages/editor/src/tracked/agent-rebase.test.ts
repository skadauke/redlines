// @vitest-environment happy-dom
// Agent edits as pushes (multiuser §4.9): an agent that read a file, worked out the whole new text
// and wrote it must not undo what others typed in between. What it changed is placed on the text as
// it is now; an edit whose text is gone is left out and told; the ledgers are merged by entry.
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { applyChanges, parse, suggestReplace } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { agentIntentOf } from './agent-intent.ts';
import { anchorChanges, rebaseAgentEdit } from './agent-rebase.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const step = { group: 'run-1', agent: 'Claude' };

const base = 'Alpha one.\n\nBravo two.\n\nCharlie three.\n\nDelta four.\n';

const replace = (text: string, from: string, to: string) => {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`no ${from}`);
  return text.slice(0, at) + to + text.slice(at + from.length);
};

describe('rebasing an agent edit', () => {
  it('at the base, is the agent text byte for byte', () => {
    const next = replace(base, 'Charlie three', 'Charlie 3');
    expect(rebaseAgentEdit(base, base, next)).toEqual({ text: next, applied: 0, dropped: [] });
  });

  it('keeps what others typed elsewhere', () => {
    const next = replace(base, 'Charlie three', 'Charlie 3');
    const typed = replace(base, 'Alpha one', 'Alpha, then one');
    const out = rebaseAgentEdit(typed, base, next);
    expect(out.text).toBe(replace(typed, 'Charlie three', 'Charlie 3'));
    expect(out.dropped).toEqual([]);
  });

  it('keeps others typing in the same paragraph, on both sides', () => {
    const next = replace(base, 'Bravo two.', 'Bravo 2.');
    const typed = replace(replace(base, 'Bravo', 'So, Bravo'), 'two.', 'two, three.');
    const out = rebaseAgentEdit(typed, base, next);
    expect(out.dropped).toEqual([]);
    expect(out.text).toContain('So, Bravo');
  });

  it('places after the typing when both insert at one point', () => {
    const next = replace(base, 'Delta four.\n', 'Delta four.\nAGENT\n');
    const typed = replace(base, 'Delta four.\n', 'Delta four.\nBO\n');
    const out = rebaseAgentEdit(typed, base, next);
    expect(out.text).toContain('BO');
    expect(out.text).toContain('AGENT');
    expect(out.dropped).toEqual([]);
  });

  it('moves with text added above it', () => {
    const next = replace(base, 'Delta four', 'Delta 4');
    const typed = `New first line.\n\n${base}`;
    expect(rebaseAgentEdit(typed, base, next).text).toBe(
      `New first line.\n\n${replace(base, 'Delta four', 'Delta 4')}`,
    );
  });

  it('finds its text when it moved, by the words around it', () => {
    const next = replace(base, 'Charlie three', 'Charlie 3');
    // Someone moved Charlie's paragraph to the top and edited the one it left.
    const typed = `Charlie three.\n\nAlpha one.\n\nBravo two.\n\nDelta four.\n`;
    const out = rebaseAgentEdit(typed, base, next);
    expect(out.text).toContain('Charlie 3.');
    expect(out.dropped).toEqual([]);
  });

  it('leaves out an edit whose text is gone, and says so', () => {
    const next = replace(base, 'Charlie three', 'Charlie 3');
    const typed = base.replace('Charlie three.\n\n', '');
    const out = rebaseAgentEdit(typed, base, next);
    expect(out.text).toBe(typed);
    expect(out.dropped).toMatchObject([{ removed: 'three', insert: '3' }]);
  });

  it('puts every agent change where the others left room, in a random order of typing', () => {
    // Seeded: others type at random places; the agent changes the second and the last paragraph.
    let seed = 20261117;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const next = replace(replace(base, 'Bravo two', 'Bravo 2'), 'Delta four', 'Delta 4');
    for (let round = 0; round < 60; round++) {
      // Three of four places in the paragraphs the agent leaves alone, from the last to the first.
      const places = [
        base.indexOf('Alpha'),
        base.indexOf('Alpha') + 6,
        base.indexOf('Charlie'),
        base.indexOf('Charlie') + 8,
      ];
      const chosen = places.filter(() => rand(4) !== 0).slice(0, 3);
      let typed = base;
      chosen.toReversed().forEach((at, i) => {
        typed = `${typed.slice(0, at)}<${i}>${typed.slice(at)}`;
      });
      const out = rebaseAgentEdit(typed, base, next);
      expect(out.dropped).toEqual([]);
      expect(out.text).toContain('Bravo 2.');
      expect(out.text).toContain('Delta 4.');
      // Everything others typed is there, in order.
      for (let i = 0; i < chosen.length; i++) expect(out.text).toContain(`<${i}>`);
      expect(out.text.replace(/<\d>/g, '')).toBe(next);
    }
  });

  it('anchors each change with the words around it', () => {
    const [change] = anchorChanges(base, replace(base, 'Charlie three', 'Charlie 3'));
    expect(change).toMatchObject({ removed: 'three', insert: '3' });
    expect(change?.before.endsWith('Charlie ')).toBe(true);
  });
});

describe('the ledger of an agent edit and of others', () => {
  const plain = 'First paragraph.\n\nSecond paragraph.\n';
  const agent = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
  const bo = { handle: 'bo', name: 'Bo Chen' };
  const suggest = (
    text: string,
    from: string,
    to: string,
    by: typeof agent | typeof bo,
    seed: number,
  ) =>
    applyChanges(
      text,
      suggestReplace(text, from, to, {
        author: by,
        time: '2026-11-17T10:00Z',
        random: (n) => Uint8Array.from({ length: n }, (_, i) => seed + i),
      }).changes,
    );

  it('keeps both writers entries: two suggestions, one ledger', () => {
    // The agent suggests in the second paragraph; Bo suggested in the first, meanwhile.
    const next = suggest(plain, 'Second', 'Third', agent, 3);
    const theirs = suggest(plain, 'First', 'Zeroth', bo, 40);
    const out = rebaseAgentEdit(theirs, plain, next);
    const parsed = parse(out.text);
    expect(out.dropped).toEqual([]);
    expect(new Set(parsed.marks.map((mark) => mark.entry.by))).toEqual(
      new Set(['bo', 'claude-ada']),
    );
    expect(parsed.ledger.people.map((p) => p.handle).sort()).toEqual(['bo', 'claude-ada']);
    expect(Object.keys(parsed.ledger.marks)).toHaveLength(parsed.marks.length);
  });

  it('renames an id both sides drew alike, in the agent text', () => {
    // The same bytes drawn on both sides: the same ids for different marks.
    const next = suggest(plain, 'Second', 'Third', agent, 7);
    const theirs = suggest(plain, 'First', 'Zeroth', bo, 7);
    const out = rebaseAgentEdit(theirs, plain, next);
    const ids = parse(out.text).marks.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(parse(out.text).marks.map((m) => m.entry.by))).toEqual(
      new Set(['bo', 'claude-ada']),
    );
  });
});

describe('in the editor', () => {
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function mount(doc: string): Editor {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc, author: ada, tracking: false });
    open.push(editor);
    return editor;
  }

  /** Someone else's typing, arriving as a remote change. */
  const remote = (editor: Editor, find: string, insert: string) => {
    const at = editor.view.state.doc.toString().indexOf(find);
    editor.view.dispatch({
      changes: { from: at, insert },
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
  };

  it('an edit made over a stale base keeps others typing', () => {
    const editor = mount(base);
    const read = editor.getDoc();
    const next = replace(read, 'Charlie three', 'Charlie 3');
    remote(editor, 'Alpha', 'Bo wrote this. ');
    const outcome = editor.applyAgentEdit(next, step, read);
    expect(outcome).toEqual({ rebased: true, dropped: [] });
    expect(editor.getDoc()).toBe(
      replace(replace(read, 'Charlie three', 'Charlie 3'), 'Alpha', 'Bo wrote this. Alpha'),
    );
    // One step of the agent's: Undo takes back the agent's edit and leaves Bo's typing.
    editor.undo();
    expect(editor.getDoc()).toBe(replace(read, 'Alpha', 'Bo wrote this. Alpha'));
  });

  it('is next, byte for byte, with the base the text still is, or with none', () => {
    const next = replace(base, 'Delta four', 'Delta 4');
    const a = mount(base);
    expect(a.applyAgentEdit(next, step, base)).toEqual({ rebased: false, dropped: [] });
    expect(a.getDoc()).toBe(next);
    const b = mount(base);
    b.applyAgentEdit(next, step);
    expect(b.getDoc()).toBe(next);
  });

  it('says what could not be placed, and throws nothing', () => {
    const editor = mount(base);
    const read = editor.getDoc();
    const next = replace(read, 'Charlie three', 'Charlie 3');
    const at = read.indexOf('Charlie three.\n\n');
    editor.view.dispatch({
      changes: { from: at, to: at + 'Charlie three.\n\n'.length },
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
    const outcome = editor.applyAgentEdit(next, step, read);
    expect(outcome.dropped).toHaveLength(1);
    expect(editor.getDoc()).not.toContain('Charlie');
  });

  it('records the edit with its base, for a session to push', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const seen: unknown[] = [];
    const editor = createEditor(parent, {
      doc: base,
      author: ada,
      extensions: [
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            const intent = agentIntentOf(tr);
            if (intent) seen.push(intent);
          }
        }),
      ],
    });
    open.push(editor);
    editor.applyAgentEdit(replace(base, 'Delta four', 'Delta 4'), step, base);
    expect(seen).toMatchObject([{ kind: 'agent', group: 'run-1', agent: 'Claude', base }]);
  });

  it('a single person file is the same bytes: the synced text is the file text', () => {
    // CRLF stays CRLF, and the open empty paragraph is not in what is synced (fileText).
    const crlf = 'One.\r\n\r\nTwo.\r\n';
    const editor = mount(crlf);
    expect(editor.getDoc()).toBe(crlf);
    editor.applyAgentEdit('One.\r\n\r\nTwo!\r\n', step, crlf);
    expect(editor.getDoc()).toBe('One.\r\n\r\nTwo!\r\n');
  });
});
