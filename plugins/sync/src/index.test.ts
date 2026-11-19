// @vitest-environment happy-dom
// Two editors in one session: typing at once with Track Changes on, in different places and in the
// same one. Both end with the authority's text, every edit is there and by its author, and the
// markup is valid.

import { Authority, Hub, memoryTransport } from '@redlines/collab';
import type { Identity } from '@redlines/collab';
import {
  anchorReview,
  createEditor,
  editSourceFacet,
  intentOf,
  moveBlocks,
  refusedEditEffect,
  rederiveReview,
} from '@redlines/editor';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from '@redlines/formatting';
import { createTables } from '@redlines/tables';
import { peersShown, syncEditor, syncText } from './index.ts';
import { FLAG_MS, showPeers } from './presence.ts';
import type { SyncBinding } from './index.ts';

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';

const people: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada (window 1)', role: 'owner', color: 'p1' },
  bo: { handle: 'bo', name: 'Bo (window 2)', role: 'editor', color: 'p2' },
};

/** A random source with a stream of its own. */
const source = (seed: number) => {
  let a = seed;
  return (n: number) =>
    Uint8Array.from({ length: n }, () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) & 0xff;
    });
};

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function window(hub: Hub, who: 'ada' | 'bo', doc: string, hosts: boolean) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const said: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: who, name: who === 'ada' ? 'Ada' : 'Bo' },
    tracking: true,
    extensions: [
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions)
          for (const effect of tr.effects)
            if (effect.is(refusedEditEffect)) said.push(effect.value);
      }),
    ],
  });
  open.push(editor);
  const notices: string[] = [];
  const binding = syncEditor(editor, {
    transport: memoryTransport(hub, `${who}-1`),
    clientID: `${who}-1`,
    credential: { key: who },
    hosts,
    notice: (message) => notices.push(message),
    retryMs: 5,
  });
  return { editor, binding, notices, said };
}

/** Types `text` at the end of the first line that contains `after`. */
function type(editor: Editor | { editor: Editor }, after: string, text: string): void {
  if ('editor' in editor) editor = editor.editor;
  const doc = editor.view.state.doc.toString();
  const at = doc.indexOf(after) + after.length;
  editor.view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  });
}

async function settle(...bindings: SyncBinding[]): Promise<void> {
  for (let round = 0; round < 30; round++) {
    await Promise.all(bindings.map((b) => b.settled()));
    const versions = new Set(bindings.map((b) => b.replica.version));
    if (versions.size === 1 && bindings.every((b) => b.replica.pending.length === 0)) break;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  // However the edits were placed, a file holds one ledger at most.
  for (const b of bindings) {
    expect(b.replica.text.toString().match(/^<!-- redlines/gm) ?? []).toHaveLength(
      b.replica.text.toString().includes('<!-- redlines') ? 1 : 0,
    );
  }
}

async function session(base = BASE) {
  const hub = new Hub(
    new Authority({
      base,
      authenticate: (credential) =>
        'key' in credential
          ? (people[credential.key] ?? { error: 'forbidden' })
          : { error: 'forbidden' },
    }),
  );
  const ada = window(hub, 'ada', base, true);
  const bo = window(hub, 'bo', '', false);
  // A joining window starts as a file is opened; each person switches Track Changes on for themselves.
  await settle(ada.binding, bo.binding);
  bo.editor.setTracking(true, { inFile: false });
  return { hub, ada, bo };
}

describe('syncEditor', () => {
  it('gives a joining window the authority’s text', async () => {
    const { ada, bo } = await session();
    await settle(ada.binding, bo.binding);
    expect(bo.editor.getDoc()).toBe(BASE);
  });

  it('converges when two people type in different paragraphs at once', async () => {
    const { hub, ada, bo } = await session();
    await settle(ada.binding, bo.binding);
    type(ada.editor, 'First', ' ADA');
    type(bo.editor, 'Third', ' BO');
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(ada.editor.view.state.doc.toString()).toBe(text);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(parse(text).warnings).toEqual([]);
    expect(text, text).toContain('ADA');
    expect(text, text).toContain('BO');
    expect(parse(text).marks.length).toBe(2);
  });

  it('converges when two people type in the same place at once, and keeps both', async () => {
    const { hub, ada, bo } = await session();
    await settle(ada.binding, bo.binding);
    type(ada.editor, 'Second', ' ADA');
    type(bo.editor, 'Second', ' BO');
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(ada.editor.view.state.doc.toString()).toBe(text);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(parse(text).warnings).toEqual([]);
    expect(text).toContain('ADA');
    expect(text).toContain('BO');
  });

  it('keeps the person’s caret where it was through someone else’s edit', async () => {
    const { ada, bo } = await session();
    await settle(ada.binding, bo.binding);
    const at = bo.editor.view.state.doc.toString().indexOf('Third');
    bo.editor.view.dispatch({ selection: { anchor: at } });
    type(ada.editor, 'First', ' ADA');
    await settle(ada.binding, bo.binding);
    const moved = bo.editor.view.state.doc.toString().indexOf('Third');
    expect(bo.editor.view.state.selection.main.head).toBe(moved);
  });

  it('converges with valid markup after three people type and delete at once', async () => {
    people['cy'] = { handle: 'cy', name: 'Cy', role: 'editor' };
    for (let seed = 1; seed <= 10; seed++) {
      const { hub, ada, bo } = await session();
      const parent = document.createElement('div');
      document.body.append(parent);
      const cy = createEditor(parent, { doc: '', author: { handle: 'cy', name: 'Cy' } });
      open.push(cy);
      const third = syncEditor(cy, {
        transport: memoryTransport(hub, 'cy-1'),
        clientID: 'cy-1',
        credential: { key: 'cy' },
        hosts: false,
        retryMs: 5,
      });
      await settle(ada.binding, bo.binding, third);
      cy.setTracking(true, { inFile: false });
      const editors = [ada.editor, bo.editor, cy];
      let state = seed * 104729;
      const next = (n: number) => (state = (state * 48271) % 2147483647) % n;
      for (let i = 0; i < 24; i++) {
        const editor = editors[next(3)]!;
        const doc = editor.view.state.doc.toString();
        const body = doc.indexOf('<!-- redlines') < 0 ? doc.length : doc.indexOf('<!-- redlines');
        const at = next(Math.max(1, body));
        if (next(4) === 0 && at + 4 < body) {
          editor.view.dispatch({ changes: { from: at, to: at + 3 }, userEvent: 'delete.forward' });
        } else {
          editor.view.dispatch({
            changes: { from: at, insert: `w${i}` },
            selection: { anchor: at + 2 },
            userEvent: 'input.type',
          });
        }
        if (next(3) === 0) await new Promise((resolve) => setTimeout(resolve, 2));
      }
      await settle(ada.binding, bo.binding, third);
      const text = hub.authority.text;
      for (const editor of editors) {
        expect(editor.view.state.doc.toString(), `seed ${seed}`).toBe(text);
      }
      expect(parse(text).warnings, `seed ${seed}`).toEqual([]);
      for (const editor of open.splice(0)) editor.destroy();
      document.body.replaceChildren();
    }
  }, 60_000);
});

describe('edits that are no typing', () => {
  it('places Bo’s agent edit on Ada’s newer text, and keeps what Ada typed', async () => {
    const { hub, ada, bo } = await session();
    await settle(ada.binding, bo.binding);
    type(ada.editor, 'First', ' ADA');
    const base = bo.editor.getDoc();
    bo.editor.applyAgentEdit(
      base.replace('Second paragraph', 'Second AGENT paragraph'),
      { group: 'g', agent: 'claude' },
      base,
    );
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(ada.editor.view.state.doc.toString()).toBe(text);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(parse(text).warnings).toEqual([]);
    expect(text).toContain('ADA');
    expect(text).toContain('Second AGENT paragraph');
    expect([...ada.notices, ...bo.notices]).toEqual([]);
  });
});

describe('a person who works alone', () => {
  it('writes the same file in a session of one window as with none, byte for byte', async () => {
    const edits = (editor: Editor) => {
      type(editor, 'First', ' one');
      type(editor, 'Second paragraph', ' two');
      type(editor, 'Third', ' three');
    };
    const make = (hosts: boolean) => {
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, {
        doc: BASE,
        author: { handle: 'ada', name: 'Ada' },
        tracking: true,
        extensions: [
          editSourceFacet.of({ now: () => new Date('2026-11-01T10:00:30Z'), random: source(9) }),
        ],
      });
      open.push(editor);
      if (hosts) {
        const hub = new Hub(
          new Authority({
            base: BASE,
            authenticate: () => ({ handle: 'ada', name: 'Ada', role: 'owner' }),
          }),
        );
        syncEditor(editor, {
          transport: memoryTransport(hub, 'ada-1'),
          clientID: 'ada-1',
          credential: { key: 'ada' },
          hosts: true,
        });
      }
      return editor;
    };
    const alone = make(false);
    const synced = make(true);
    edits(alone);
    edits(synced);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(synced.getDoc()).toBe(alone.getDoc());
    expect(synced.getDoc()).toContain('three');
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits, a few milliseconds at a time, until `test` holds: presence follows a move a moment later. */
async function until(test: () => boolean, ms = 3000): Promise<void> {
  for (let waited = 0; waited < ms && !test(); waited += 10) await wait(10);
}

/** The undo the keyboard and the Edit menu reach: an input event of the page. */
function undoKey(editor: Editor): void {
  editor.view.contentDOM.dispatchEvent(
    new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }),
  );
}

describe('the other window’s caret', () => {
  it('shows where it is, among the same words, in its color', async () => {
    const { ada, bo } = await session();
    const doc = ada.editor.view.state.doc.toString();
    const at = doc.indexOf('Second') + 3;
    ada.editor.view.dispatch({ selection: { anchor: at, head: at + 6 } });
    await until(() => peersShown(bo.editor.view).length === 1);
    await settle(ada.binding, bo.binding);
    const peers = peersShown(bo.editor.view);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ name: 'Ada (window 1)', color: 'p1' });
    const text = bo.editor.view.state.doc.toString();
    expect(text.slice(peers[0]!.anchor, peers[0]!.head)).toBe(doc.slice(at, at + 6));
    // Ada sees Bo in Bo’s color.
    bo.editor.view.dispatch({ selection: { anchor: 3 } });
    await until(() => peersShown(ada.editor.view).length === 1);
    expect(peersShown(ada.editor.view)[0]).toMatchObject({ name: 'Bo (window 2)', color: 'p2' });
  });

  it('keeps the caret and its name flag showing while a selection lasts, and lets a caret’s flag go (#1168)', async () => {
    const { bo } = await session();
    const peer = {
      clientID: 'c1',
      name: 'Ada (window 1)',
      color: 'p1',
      head: 8,
      anchor: 8,
      // It moved long ago.
      stamp: Date.now() - FLAG_MS - 1000,
    };
    const flags = () => [...bo.editor.view.dom.querySelectorAll('.rl-presence-flag')];
    showPeers(bo.editor.view, [peer]);
    expect(bo.editor.view.dom.querySelectorAll('.rl-presence-caret')).toHaveLength(1);
    expect(flags(), 'a caret alone has lost its flag by now').toHaveLength(0);
    showPeers(bo.editor.view, [{ ...peer, anchor: 3 }]);
    expect(bo.editor.view.dom.querySelectorAll('.rl-presence-selection').length).toBeGreaterThan(0);
    expect(bo.editor.view.dom.querySelectorAll('.rl-presence-caret')).toHaveLength(1);
    expect(flags().map((flag) => flag.textContent)).toEqual(['Ada (window 1)']);
    expect(flags()[0]!.classList.contains('rl-presence-flag-stays')).toBe(true);
    // The selection collapses: the flag, long past its time, goes.
    showPeers(bo.editor.view, [{ ...peer, anchor: 8 }]);
    expect(flags()).toHaveLength(0);
  });

  it('moves with the text when the person types before it', async () => {
    const { ada, bo } = await session();
    const at = ada.editor.view.state.doc.toString().indexOf('Third');
    ada.editor.view.dispatch({ selection: { anchor: at } });
    await until(() => peersShown(bo.editor.view).length === 1);
    type(bo.editor, 'First', ' BO');
    await settle(ada.binding, bo.binding);
    const place = peersShown(bo.editor.view)[0]!.head;
    expect(bo.editor.view.state.doc.toString().slice(place).startsWith('Third')).toBe(true);
    // And in the window that typed, before the message that says so.
    type(bo.editor, 'Second', ' MORE');
    expect(bo.editor.view.state.doc.toString().slice(peersShown(bo.editor.view)[0]!.head)).toMatch(
      /^Third/,
    );
  });

  it('goes when the window leaves', async () => {
    const { ada, bo } = await session();
    ada.editor.view.dispatch({ selection: { anchor: 4 } });
    await until(() => peersShown(bo.editor.view).length === 1);
    expect(peersShown(bo.editor.view)).toHaveLength(1);
    await ada.binding.stop();
    await until(() => peersShown(bo.editor.view).length === 0);
    expect(peersShown(bo.editor.view)).toHaveLength(0);
  });
});

describe('undo in two windows', () => {
  it('takes back only the person’s own edit, leaving the other window’s', async () => {
    const { hub, ada, bo } = await session();
    ada.editor.setTracking(false, { inFile: false });
    bo.editor.setTracking(false, { inFile: false });
    type(ada.editor, 'First', ' ONE');
    type(bo.editor, 'Third', ' TWO');
    await settle(ada.binding, bo.binding);
    undoKey(ada.editor);
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(text).not.toContain(' ONE');
    expect(text).toContain(' TWO');
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('takes back a tracked edit by its marks, leaving the other window’s', async () => {
    const { hub, ada, bo } = await session();
    type(ada.editor, 'First', ' ONE');
    type(bo.editor, 'Third', ' TWO');
    await settle(ada.binding, bo.binding);
    expect(hub.authority.text).toContain('ONE');
    ada.editor.undo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(text, text).not.toContain(' ONE');
    expect(text).toContain(' TWO');
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.notices).toEqual([]);
  });

  it('takes back a step by its marks when the other window’s edit came between its keystrokes', async () => {
    const { hub, ada, bo } = await session();
    type(ada.editor, 'First', ' ONE');
    type(bo.editor, 'Third', ' TWO');
    await settle(ada.binding, bo.binding);
    // Ada goes on typing where she stopped: the same step, after the other window's edit and its
    // ledger entry came in.
    type(ada.editor, ' ONE', ' MORE');
    await settle(ada.binding, bo.binding);
    // One step, or two when the machine was slow between the keystrokes: Undo until it is all back.
    for (let i = 0; i < 2 && hub.authority.text.includes('ONE'); i++) {
      ada.editor.undo();
      await settle(ada.binding, bo.binding);
    }
    const text = hub.authority.text;
    expect(text).not.toContain('ONE');
    expect(text).not.toContain('MORE');
    expect(text).toContain(' TWO');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('goes on after several remote changes in a row (no mismatched change sets)', async () => {
    const { hub, ada, bo } = await session();
    ada.editor.setTracking(false, { inFile: false });
    bo.editor.setTracking(false, { inFile: false });
    type(ada.editor, 'First', ' ONE');
    for (const [at, text] of [
      ['Second', ' a'],
      ['Third', ' b'],
      ['First', ' c'],
    ] as const) {
      type(bo.editor, at, text);
      await settle(ada.binding, bo.binding);
    }
    ada.editor.undo();
    await settle(ada.binding, bo.binding);
    expect(hub.authority.text).not.toContain(' ONE');
    expect(hub.authority.text).toContain(' a');
    expect(ada.notices).toEqual([]);
  });

  it('is not refused for the other window’s ledger entries beside a tracked step', async () => {
    const { hub, ada, bo } = await session();
    type(ada.editor, 'First', ' ONE');
    type(bo.editor, 'Third', ' TWO');
    await settle(ada.binding, bo.binding);
    ada.editor.undo();
    await settle(ada.binding, bo.binding);
    expect(ada.said).toEqual([]);
    expect(hub.authority.text).not.toContain(' ONE');
    expect(hub.authority.text).toContain(' TWO');
    expect(parse(hub.authority.text).warnings).toEqual([]);
  });

  it('takes back what is left of its step when the other window typed inside, and keeps theirs', async () => {
    const { hub, ada, bo } = await session();
    ada.editor.setTracking(false, { inFile: false });
    bo.editor.setTracking(false, { inFile: false });
    type(ada.editor, 'First', ' ONE');
    await settle(ada.binding, bo.binding);
    // Bo types inside the words Ada just wrote.
    type(bo.editor, ' O', 'X');
    await settle(ada.binding, bo.binding);
    ada.editor.undo();
    await settle(ada.binding, bo.binding);
    expect(hub.authority.text).toContain('X');
    expect(hub.authority.text).not.toContain('ONE');
    expect(ada.said).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(hub.authority.text);
  });

  it('places two Undos in a row over another window’s ledger write', async () => {
    const { hub, ada, bo } = await session();
    type(bo.editor, 'Second', ' KEEP');
    await settle(ada.binding, bo.binding);
    await new Promise((resolve) => setTimeout(resolve, 650));
    type(bo.editor, 'Third', ' BO');
    await settle(ada.binding, bo.binding);
    type(ada.editor, 'First', ' ADA');
    bo.editor.undo();
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(text).toContain(' ADA');
    expect(text).not.toContain(' KEEP');
    expect(text).not.toContain(' BO');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('keeps an Undo of a lone tracked mark over another window’s ledger write', async () => {
    const { hub, ada, bo } = await session();
    type(bo.editor, 'Third', ' BO');
    await settle(ada.binding, bo.binding);
    type(ada.editor, 'First', ' ADA');
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(text).toContain(' ADA');
    expect(text).not.toContain(' BO');
    expect(parse(text).warnings).toEqual([]);
    expect(Object.keys(parse(text).ledger.marks)).toHaveLength(1);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('keeps an Undo over another window’s ledger write, and takes nothing back', async () => {
    const { hub, ada, bo } = await session();
    type(bo.editor, 'Second', ' KEEP');
    await settle(ada.binding, bo.binding);
    await new Promise((resolve) => setTimeout(resolve, 650));
    type(bo.editor, 'Third', ' BO');
    await settle(ada.binding, bo.binding);
    // Ada writes the ledger while Bo's Undo, which removes a mark's entry, is still on its way.
    type(ada.editor, 'First', ' ADA');
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(text).toContain(' KEEP');
    expect(text).toContain(' ADA');
    expect(text).not.toContain(' BO');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });
});

describe('commands over another window’s edit', () => {
  it('places a bold over a word that the other window typed inside', async () => {
    const { hub, ada, bo } = await session();
    const remove = createFormatting(bo.editor, {
      author: { handle: 'bo', name: 'Bo' },
      notice: (message) => bo.notices.push(message),
    });
    bo.editor.view.dispatch({
      selection: {
        anchor: bo.editor.view.state.doc.toString().indexOf('Second paragraph') + 7,
        head: bo.editor.view.state.doc.toString().indexOf('Second paragraph') + 16,
      },
    });
    type(ada.editor, 'Second para', 'X');
    expect(bo.editor.commands.run('format.bold')).toBe(true);
    await settle(ada.binding, bo.binding);
    remove();
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(text).toContain('X');
    // Widened to hold the other window's typing, which stays pending inside it.
    expect(newestView(text).text).toContain('**paraXgraph**');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });

  it('places a bold over a paragraph that the other window typed at the start of', async () => {
    const { hub, ada, bo } = await session();
    const remove = createFormatting(bo.editor, {
      author: { handle: 'bo', name: 'Bo' },
      notice: (message) => bo.notices.push(message),
    });
    const at = bo.editor.view.state.doc.toString().indexOf('Second paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at, head: at + 22 } });
    type(ada.editor, 'First paragraph here.\n\n', 'X');
    expect(bo.editor.commands.run('format.bold')).toBe(true);
    await settle(ada.binding, bo.binding);
    remove();
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    // Still three paragraphs: the other window's text is in the one it typed in, and the bold is
    // on the words it was made on.
    expect(newestView(text).text.split('\n\n').slice(0, 3)).toEqual([
      'First paragraph here.',
      'X**Second paragraph here.**',
      'Third paragraph here.\n',
    ]);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('tells a person that the words they formatted were deleted', async () => {
    const { hub, ada, bo } = await session();
    const remove = createFormatting(bo.editor, {
      author: { handle: 'bo', name: 'Bo' },
      notice: (message) => bo.notices.push(message),
    });
    ada.editor.setTracking(false, { inFile: false });
    const at = bo.editor.view.state.doc.toString().indexOf('Second paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at, head: at + 22 } });
    // Ada deletes the paragraph outright (Track Changes off) while Bo's bold is still on its way.
    ada.editor.view.dispatch({
      changes: { from: at, to: at + 24, insert: '' },
      userEvent: 'delete.selection',
    });
    expect(bo.editor.commands.run('format.bold')).toBe(true);
    await settle(ada.binding, bo.binding);
    remove();
    const text = hub.authority.text;
    expect(text).not.toContain('Second');
    expect(bo.notices.join(' ')).toMatch(/formatted/);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  const moved = async (after: string, text: string) => {
    const { hub, ada, bo } = await session();
    const at = bo.editor.view.state.doc.toString().indexOf('Third paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 2 } });
    type(ada.editor, after, text);
    moveBlocks(bo.editor.view, true);
    await settle(ada.binding, bo.binding);
    const doc = hub.authority.text;
    expect(parse(doc).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(doc);
    expect(ada.editor.view.state.doc.toString()).toBe(doc);
    return { notices: bo.notices, paragraphs: newestView(doc).text.split('\n\n').slice(0, 3) };
  };

  it('places a move of a paragraph that the other window typed inside', async () => {
    const { notices, paragraphs } = await moved('Third para', 'X');
    expect(notices).toEqual([]);
    expect(paragraphs).toEqual([
      'First paragraph here.',
      'Third paraXgraph here.',
      'Second paragraph here.\n',
    ]);
  });

  it('places a move over a paragraph that the other window typed at the start of', async () => {
    const { notices, paragraphs } = await moved('First paragraph here.\n\n', 'X');
    expect(notices).toEqual([]);
    expect(paragraphs).toEqual([
      'First paragraph here.',
      'Third paragraph here.',
      'XSecond paragraph here.\n',
    ]);
  });

  it('tells a person that the paragraph they moved was deleted, and moves nothing', async () => {
    const { hub, ada, bo } = await session();
    ada.editor.setTracking(false, { inFile: false });
    const doc = bo.editor.view.state.doc.toString();
    const at = doc.indexOf('Third paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 2 } });
    ada.editor.view.dispatch({
      changes: { from: at - 2, to: at + 'Third paragraph here.'.length, insert: '' },
      userEvent: 'delete.selection',
    });
    moveBlocks(bo.editor.view, true);
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices.join(' ')).toMatch(/moved/);
    expect(text).not.toContain('Third');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  const TBL = 'Intro.\n\n| a | b |\n| - | - |\n| one | two |\n| three | four |\n\nAfter.\n';

  it('places a row deletion after the other window added a row above', async () => {
    const { hub, ada, bo } = await session(TBL);
    const removes = [createTables(ada.editor), createTables(bo.editor)];
    const doc = bo.editor.view.state.doc.toString();
    ada.editor.view.dispatch({ selection: { anchor: doc.indexOf('one') + 1 } });
    bo.editor.view.dispatch({ selection: { anchor: doc.indexOf('three') + 1 } });
    expect(ada.editor.commands.run('table.insertRowAbove')).toBe(true);
    expect(bo.editor.commands.run('table.deleteRow')).toBe(true);
    await settle(ada.binding, bo.binding);
    for (const remove of removes) remove();
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(parse(text).warnings).toEqual([]);
    // The row Bo meant is the one that is deleted: "three" is gone from the newest text, "one" stays.
    expect(newestView(text).text).toContain('| one |');
    expect(newestView(text).text).not.toContain('three');
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });

  it('tells a person that the row they deleted is gone', async () => {
    const { hub, ada, bo } = await session(TBL);
    const removes = [createTables(ada.editor), createTables(bo.editor)];
    ada.editor.setTracking(false, { inFile: false });
    const doc = bo.editor.view.state.doc.toString();
    bo.editor.view.dispatch({ selection: { anchor: doc.indexOf('three') + 1 } });
    ada.editor.view.dispatch({ selection: { anchor: doc.indexOf('three') + 1 } });
    expect(ada.editor.commands.run('table.deleteRow')).toBe(true);
    expect(bo.editor.commands.run('table.deleteRow')).toBe(true);
    await settle(ada.binding, bo.binding);
    for (const remove of removes) remove();
    const text = hub.authority.text;
    expect(parse(text).warnings).toEqual([]);
    expect(newestView(text).text).toContain('| one |');
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it.each([
    ['one', 'table.insertRowAbove', 'three', 'table.insertRowBelow'],
    ['one', 'table.deleteRow', 'three', 'table.deleteRow'],
    ['one', 'table.insertRowAbove', 'three', 'table.moveRowUp'],
    ['a', 'table.insertColumnLeft', 'two', 'table.deleteColumn'],
    ['a', 'table.insertColumnLeft', 'four', 'table.alignRight'],
    ['two', 'table.deleteColumn', 'three', 'table.insertRowAbove'],
    ['three', 'table.deleteRow', 'one', 'table.moveRowDown'],
  ])('keeps both windows’ table commands: Ada %s %s, Bo %s %s', async (aw, ac, bw, bc) => {
    const { hub, ada, bo } = await session(TBL);
    const removes = [createTables(ada.editor), createTables(bo.editor)];
    const doc = bo.editor.view.state.doc.toString();
    ada.editor.view.dispatch({ selection: { anchor: doc.indexOf(aw, doc.indexOf('| a')) + 1 } });
    bo.editor.view.dispatch({ selection: { anchor: doc.indexOf(bw, doc.indexOf('| a')) + 1 } });
    const r1 = ada.editor.commands.run(ac);
    const r2 = bo.editor.commands.run(bc);
    await settle(ada.binding, bo.binding);
    for (const remove of removes) remove();
    const text = hub.authority.text;
    expect(r1 && r2).toBe(true);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
    // Nothing is taken back without a sentence that says what happened.
    for (const notice of bo.notices) expect(notice).toMatch(/table|rows|someone else/i);
  });

  /** Waits out the history's grouping, so that the next edit is a step of its own. */
  const later = () => new Promise((resolve) => setTimeout(resolve, 650));

  it('undoes and redoes a bold while the other window types in the paragraph', async () => {
    const { hub, ada, bo } = await session();
    const remove = createFormatting(bo.editor, {
      author: { handle: 'bo', name: 'Bo' },
      notice: (message) => bo.notices.push(message),
    });
    const at = bo.editor.view.state.doc.toString().indexOf('Second paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 7, head: at + 16 } });
    expect(bo.editor.commands.run('format.bold')).toBe(true);
    await settle(ada.binding, bo.binding);
    await later();
    type(ada.editor, 'Second', ' ADA');
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(newestView(hub.authority.text).text).toContain('Second ADA paragraph');
    expect(newestView(hub.authority.text).text).not.toContain('**');
    type(ada.editor, 'Third', ' MORE');
    await settle(ada.binding, bo.binding);
    bo.editor.redo();
    await settle(ada.binding, bo.binding);
    remove();
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(newestView(text).text).toContain('**paragraph**');
    expect(newestView(text).text).toContain(' MORE');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });

  it('undoes and redoes a move while the other window types in the moved paragraph', async () => {
    const { hub, ada, bo } = await session();
    const at = bo.editor.view.state.doc.toString().indexOf('Third paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 2 } });
    moveBlocks(bo.editor.view, true);
    await settle(ada.binding, bo.binding);
    await later();
    type(ada.editor, 'Third para', 'X');
    await settle(ada.binding, bo.binding);
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    expect(bo.notices).toEqual([]);
    expect(newestView(hub.authority.text).text.split('\n\n').slice(0, 3)).toEqual([
      'First paragraph here.',
      'XSecond paragraph here.',
      'Third paragraph here.\n',
    ]);
    type(ada.editor, 'First', ' MORE');
    await settle(ada.binding, bo.binding);
    bo.editor.redo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(newestView(text).text.split('\n\n').slice(0, 3)).toEqual([
      'First MORE paragraph here.',
      'Third paraXgraph here.',
      'Second paragraph here.\n',
    ]);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });

  it('applies an accept of the other window’s suggestion while it types nearby', async () => {
    const { hub, ada, bo } = await session();
    type(ada.editor, 'First', ' ADA');
    await settle(ada.binding, bo.binding);
    const id = parse(bo.editor.view.state.doc.toString()).marks[0]!.id;
    // Ada types in the next paragraph while Bo's accept is still on its way.
    type(ada.editor, 'Second', ' NEAR');
    bo.editor.accept(id);
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(newestView(text).text).toContain('First ADA paragraph');
    // Bo's accept took ADA into the text; NEAR is Ada's, still a suggestion of hers.
    expect(parse(text).marks.map((mark) => mark.id)).not.toContain(id);
    expect(parse(text).marks).toHaveLength(1);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });

  it('says why a decision was not applied when the other window changed the suggestion', async () => {
    const { hub, ada, bo } = await session();
    type(ada.editor, 'First', ' ADA');
    await settle(ada.binding, bo.binding);
    const id = parse(bo.editor.view.state.doc.toString()).marks[0]!.id;
    // Ada goes on typing inside her own suggestion, which changes it, while Bo's reject is on its way.
    type(ada.editor, ' ADA', ' MORE');
    bo.editor.reject(id);
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    // Either the reject was placed on the suggestion as it is now, or Bo is told it wasn't.
    const gone = !newestView(text).text.includes('ADA');
    expect(gone || bo.notices.some((notice) => /suggestion/.test(notice))).toBe(true);
  });

  it('redoes a bold before the other window’s ledger write arrives, with one ledger', async () => {
    const { hub, ada, bo } = await session();
    const remove = createFormatting(bo.editor, {
      author: { handle: 'bo', name: 'Bo' },
      notice: (message) => bo.notices.push(message),
    });
    const at = bo.editor.view.state.doc.toString().indexOf('Second paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 7, head: at + 16 } });
    expect(bo.editor.commands.run('format.bold')).toBe(true);
    await settle(ada.binding, bo.binding);
    await later();
    type(ada.editor, 'Second', ' ADA');
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    // Ada writes the ledger, and Bo's Redo runs before it arrives.
    type(ada.editor, 'Third', ' MORE');
    bo.editor.redo();
    await settle(ada.binding, bo.binding);
    remove();
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(text.match(/<!-- redlines/g)).toHaveLength(1);
    expect(newestView(text).text).toContain('**paragraph**');
    expect(newestView(text).text).toContain(' MORE');
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
    expect(ada.editor.view.state.doc.toString()).toBe(text);
  });

  it('undoes a move before the other window’s typing inside the moved paragraph arrives', async () => {
    const { hub, ada, bo } = await session();
    const at = bo.editor.view.state.doc.toString().indexOf('Third paragraph');
    bo.editor.view.dispatch({ selection: { anchor: at + 2 } });
    moveBlocks(bo.editor.view, true);
    await settle(ada.binding, bo.binding);
    await later();
    type(ada.editor, 'Third para', 'X');
    bo.editor.undo();
    await settle(ada.binding, bo.binding);
    const text = hub.authority.text;
    expect(bo.notices).toEqual([]);
    expect(bo.said).toEqual([]);
    expect(text.match(/<!-- redlines/g) ?? []).toHaveLength(1);
    // The same as when Ada's typing had arrived first: the move is undone, and her X stays.
    expect(newestView(text).text.split('\n\n').slice(0, 3)).toEqual([
      'First paragraph here.',
      'XSecond paragraph here.',
      'Third paragraph here.\n',
    ]);
    expect(parse(text).warnings).toEqual([]);
    expect(bo.editor.view.state.doc.toString()).toBe(text);
  });
});

describe('a file with line breaks of its own kind', () => {
  const CRLF = 'First paragraph here.\r\n\r\nSecond\r\nparagraph here.\r\n';
  const MIXED = 'First paragraph here.\r\n\r\nSecond\nparagraph here.\r\n\r\nThird\nparagraph.\n';

  /** Every window shows the authority's text, as the file has it, and nobody was told of a take-back. */
  function agree(hub: Hub, ...windows: ReturnType<typeof window>[]) {
    for (const w of windows) {
      expect(JSON.stringify(syncText(w.editor.view.state))).toBe(
        JSON.stringify(hub.authority.text),
      );
      expect(w.notices).toEqual([]);
      expect(w.said).toEqual([]);
    }
    expect(parse(hub.authority.text).warnings).toEqual([]);
  }

  /** The offset in the window's document of the line break after `line`. */
  const breakAfter = (w: ReturnType<typeof window>, line: string) =>
    w.editor.view.state.doc.toString().indexOf(line) + line.length;

  it('lands typing, deleting, accepting and rejecting in both windows (#1057)', async () => {
    const { hub, ada, bo } = await session(CRLF);
    expect(bo.editor.getDoc()).toBe(CRLF);
    type(ada, 'First', ' ADA');
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    expect(hub.authority.text).toContain('\r\n');
    // Bo deletes a line break, and Ada rejects it: the break comes back as the file's own.
    const at = breakAfter(bo, 'Second');
    bo.editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    const del = parse(hub.authority.text).marks.find((mark) => mark.kind === 'del');
    expect(del).toBeDefined();
    ada.editor.reject(del!.id);
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    expect(hub.authority.text).toContain('Second\r\nparagraph here.');
    expect(hub.authority.text.replace(/\r\n/g, '')).not.toContain('\n');
    // Ada accepts her own typing; Bo types after it.
    const mark = parse(hub.authority.text).marks.find((m) => m.kind === 'ins')!;
    ada.editor.accept(mark.id);
    await settle(ada.binding, bo.binding);
    type(bo, 'Second\nparagraph', ' BO');
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    expect(newestView(hub.authority.text).text).toContain('First ADA paragraph');
    expect(hub.authority.text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('brings back a break of the other kind in a file that mixes them, in the other window', async () => {
    const { hub, ada, bo } = await session(MIXED);
    expect(bo.editor.getDoc()).toBe(MIXED);
    // Bo deletes the LF after Second; Ada rejects while Bo types beside it, so her reject is placed again.
    const at = breakAfter(bo, 'Second');
    bo.editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    const del = parse(hub.authority.text).marks.find((mark) => mark.kind === 'del')!;
    ada.editor.reject(del.id);
    type(bo, 'Second', ' BO');
    // Bo's edit is confirmed first, so Ada's reject is written again on the text that follows it.
    await bo.binding.settled();
    await settle(ada.binding, bo.binding);
    agree(hub, ada, bo);
    expect(hub.authority.text).toContain(' BO<!--/');
    expect(hub.authority.text).toContain('\nparagraph here.\r\n');
    expect(hub.authority.text).not.toContain('\r\nparagraph here.\r\n\r\nThird');
    expect(hub.authority.text).toContain('First paragraph here.\r\n\r\n');
  });
  it('writes a replayed reject on the file, with the kind of the break it brings back (#1057)', async () => {
    const { hub, ada, bo } = await session(MIXED);
    const at = breakAfter(bo, 'Second');
    bo.editor.view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'delete.forward' });
    await settle(ada.binding, bo.binding);
    const del = parse(hub.authority.text).marks.find((mark) => mark.kind === 'del')!;
    const before = ada.editor.view.state;
    let intent: ReturnType<typeof intentOf> | undefined;
    ada.editor.addExtension(
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) intent ??= intentOf(tr);
      }),
    );
    ada.editor.reject(del.id);
    expect(intent?.kind).toBe('review');
    if (intent?.kind !== 'review') return;
    // Replayed on the newest text, the reject brings back the LF the file had, not the CRLF.
    const placed = rederiveReview(before, anchorReview(before.doc.toString(), intent));
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.styles).toHaveLength(1);
    expect(placed.styles![0]!.style).toBe('\n');
  });
});
