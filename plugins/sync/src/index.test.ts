// @vitest-environment happy-dom
// Two editors in one session: typing at once with Track Changes on, in different places and in the
// same one. Both end with the authority's text, every edit is there and by its author, and the
// markup is valid.

import { Authority, Hub, memoryTransport } from '@redlines/collab';
import type { Identity } from '@redlines/collab';
import { createEditor, editSourceFacet } from '@redlines/editor';
import type { Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { syncEditor } from './index.ts';
import type { SyncBinding } from './index.ts';

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';

const people: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada', role: 'owner' },
  bo: { handle: 'bo', name: 'Bo', role: 'editor' },
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
  const editor = createEditor(parent, {
    doc,
    author: { handle: who, name: people[who]!.name },
    tracking: true,
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
  return { editor, binding, notices };
}

/** Types `text` at the end of the first line that contains `after`. */
function type(editor: Editor, after: string, text: string): void {
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
    if (versions.size === 1 && bindings.every((b) => b.replica.pending.length === 0)) return;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
}

async function session() {
  const hub = new Hub(
    new Authority({
      base: BASE,
      authenticate: (credential) =>
        'key' in credential
          ? (people[credential.key] ?? { error: 'forbidden' })
          : { error: 'forbidden' },
    }),
  );
  const ada = window(hub, 'ada', BASE, true);
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
