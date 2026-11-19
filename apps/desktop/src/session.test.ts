// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/require-await -- the fake app answers at once, as an async command does */
// One document in two windows (src/session.ts), with a fake app between them: the windows are two
// editors in one page, the events between them are a bus, and the app's list of sessions and its
// log are the fakes below, which do what src-tauri/src/session.rs does.

import { createEditor, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { EVENTS, joinSession, ordinalOf, PortLog, windowNumberOf } from './session.ts';
import type { Joined, Moved, Session, SessionPorts } from './session.ts';

const BASE = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n';
const PATH = '/docs/plan.md';

interface Held {
  leader: string;
  members: string[];
  epoch: number;
}

/** What the app does: who leads, which epoch, and the log. */
class FakeApp {
  sessions = new Map<string, Held>();
  logs = new Map<string, { base: string; records: string[] }>();
  /** Logs an earlier run left. */
  left = new Map<string, { base: string; records: string[] }>();
  readonly listeners = new Map<string, Map<string, (payload: unknown) => void>>();

  ports(label: string): SessionPorts {
    return {
      label,
      join: async (path) => {
        let held = this.sessions.get(path);
        const fresh = !held;
        if (!held) {
          held = { leader: label, members: [], epoch: 1 };
          this.sessions.set(path, held);
        }
        if (!held.members.includes(label)) held.members.push(label);
        const joined: Joined = {
          leader: held.leader,
          epoch: held.epoch,
          leading: held.leader === label,
          left: fresh ? (this.left.get(path) ?? null) : null,
        };
        return joined;
      },
      walStart: async (path, epoch, base) => {
        this.mayWrite(path, label, epoch);
        this.logs.set(path, { base, records: [] });
      },
      walAppend: async (path, epoch, lines) => {
        this.mayWrite(path, label, epoch);
        this.logs.get(path)?.records.push(...lines);
      },
      walRead: async (path) => this.logs.get(path) ?? null,
      members: async (path) => this.sessions.get(path)?.members ?? [],
      leave: async (path) => this.leave(label, path),
      send: async (to, event, payload) => {
        // Delivered later, as events between windows are.
        await Promise.resolve();
        this.listeners.get(to)?.get(event)?.(JSON.parse(JSON.stringify(payload)));
      },
      listen: async (event, handler) => {
        const mine = this.listeners.get(label) ?? new Map<string, (payload: unknown) => void>();
        this.listeners.set(label, mine);
        mine.set(event, handler);
        return () => void mine.delete(event);
      },
    };
  }

  mayWrite(path: string, label: string, epoch: number): void {
    const held = this.sessions.get(path);
    if (!held || held.leader !== label || epoch < held.epoch) throw new Error('refused');
  }

  leave(label: string, path: string): void {
    const held = this.sessions.get(path);
    if (!held) return;
    held.members = held.members.filter((member) => member !== label);
    if (held.members.length === 0) {
      this.sessions.delete(path);
      return;
    }
    if (held.leader === label) {
      held.leader = held.members[0]!;
      held.epoch++;
      const moved: Moved = { path, leader: held.leader, epoch: held.epoch };
      for (const member of held.members) this.listeners.get(member)?.get(EVENTS.moved)?.(moved);
    } else {
      this.listeners.get(held.leader)?.get(EVENTS.left)?.({ path, window: label });
    }
  }
}

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorFor(doc: string): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada' },
  });
  open.push(editor);
  return editor;
}

interface Window {
  label: string;
  editor: Editor;
  session: Session;
  saved: string[];
  /** What it was told the file holds. */
  told: string[];
  notices: string[];
  /** What other windows told it about Track Changes. */
  heardTracking: boolean[];
}

async function windowOn(app: FakeApp, label: string, doc: string): Promise<Window> {
  const editor = editorFor(doc);
  const saved: string[] = [];
  const told: string[] = [];
  const notices: string[] = [];
  const heardTracking: boolean[] = [];
  let disk: string | null = doc === '' ? null : doc;
  const session = await joinSession(app.ports(label), editor, {
    path: PATH,
    person: { handle: 'ada', name: 'Ada' },
    diskText: () => disk,
    onSaved: (text) => told.push(text),
    save: async () => {
      const text = editor.view.state.doc.toString();
      saved.push(text);
      disk = text;
      return text;
    },
    notice: (message) => notices.push(message),
    onTracking: (on) => {
      heardTracking.push(on);
      editor.setTracking(on, { inFile: false });
    },
    tracking: () => editor.getUiState().tracking,
    saveDelayMs: 20,
  });
  return { label, editor, session, saved, told, notices, heardTracking };
}

function type(editor: Editor, after: string, text: string): void {
  const at = editor.view.state.doc.toString().indexOf(after) + after.length;
  editor.view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  });
}

async function settle(...windows: Window[]): Promise<void> {
  for (let round = 0; round < 60; round++) {
    await Promise.all(windows.map((w) => w.session.binding.settled()));
    const versions = new Set(windows.map((w) => w.session.binding.replica.version));
    if (versions.size === 1 && windows.every((w) => w.session.confirmed)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a document in two windows', () => {
  it('shows the leader’s text in the window that joins, and both type at once', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    expect(one.session.leading).toBe(true);
    expect(two.session.leading).toBe(false);
    expect(two.editor.view.state.doc.toString()).toBe(BASE);
    two.editor.setTracking(true, { inFile: false });
    one.editor.setTracking(true, { inFile: false });
    type(one.editor, 'First', ' ONE');
    type(two.editor, 'Third', ' TWO');
    await settle(one, two);
    const text = one.editor.view.state.doc.toString();
    expect(two.editor.view.state.doc.toString()).toBe(text);
    expect(parse(text).warnings).toEqual([]);
    expect(text).toContain('ONE');
    expect(text).toContain('TWO');
  });

  it('turns Track Changes on and off in every window of the document (#1166)', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    const on: boolean[] = [];
    const shared = (w: Window, value: boolean) => {
      w.editor.setTracking(value, { inFile: false });
      return w.session.shareTracking(value);
    };
    expect(two.editor.getUiState().tracking).toBe(false);
    await shared(one, true);
    await wait(20);
    on.push(one.editor.getUiState().tracking, two.editor.getUiState().tracking);
    await shared(two, false);
    await wait(20);
    on.push(one.editor.getUiState().tracking, two.editor.getUiState().tracking);
    expect(on).toEqual([true, true, false, false]);
    expect(two.heardTracking).toEqual([true]);
    expect(one.heardTracking).toEqual([false]);
  });

  it('turns Track Changes on and off in every window of the document (#1166)', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    const tracking = () => [one, two].map((w) => w.editor.getUiState().tracking);
    const turn = async (w: Window, on: boolean) => {
      w.editor.setTracking(on, { inFile: false });
      await w.session.shareTracking(on);
      await wait(20);
    };
    expect(tracking()).toEqual([false, false]);
    await turn(one, true);
    expect(tracking()).toEqual([true, true]);
    await turn(two, false);
    expect(tracking()).toEqual([false, false]);
    expect(two.heardTracking).toEqual([true]);
    expect(one.heardTracking).toEqual([false]);
  });

  it('gives a window that joins the leader’s Track Changes setting (#1166)', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    one.editor.setTracking(true, { inFile: false });
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    for (const w of [one, two]) w.editor.view.dispatch({ selection: { anchor: 2 } });
    await wait(400);
    expect(two.editor.getUiState().tracking).toBe(true);
    expect(two.heardTracking).toEqual([true]);
  });

  it('keeps a file with CRLF line breaks as it is, in both windows, with no edit taken back (#1057)', async () => {
    const crlf = 'First paragraph here.\r\n\r\nSecond\r\nparagraph here.\r\n';
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', crlf);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    expect(two.editor.getDoc()).toBe(crlf);
    two.editor.setTracking(true, { inFile: false });
    one.editor.setTracking(true, { inFile: false });
    type(one.editor, 'First', ' ONE');
    type(two.editor, 'Second', ' TWO');
    await settle(one, two);
    const text = one.editor.getDoc();
    expect(two.editor.getDoc()).toBe(text);
    expect(text).toContain('First<!--ins');
    expect(text).toContain('Second<!--ins');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parse(text).warnings).toEqual([]);
    expect([...one.notices, ...two.notices]).toEqual([]);
  });

  it('saves the file once, from the leader, after a pause', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    type(one.editor, 'First', ' ONE');
    type(two.editor, 'Third', ' TWO');
    type(two.editor, 'Second', ' MORE');
    await settle(one, two);
    await wait(120);
    expect(two.saved).toEqual([]);
    expect(one.saved).toHaveLength(1);
    expect(one.saved[0]).toBe(one.editor.view.state.doc.toString());
  });

  it('asks the leader to save when another window is asked to', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    type(two.editor, 'Third', ' TWO');
    await settle(one, two);
    const text = await two.session.save();
    expect(text).toBe(one.editor.view.state.doc.toString());
    expect(one.saved).toContain(text);
    expect(two.saved).toEqual([]);
  });

  it('goes on in the other window when the leader closes, with nothing lost', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    type(one.editor, 'First', ' ONE');
    await settle(one, two);
    await one.session.stop();
    await wait(30);
    expect(two.session.leading).toBe(true);
    type(two.editor, 'Second', ' TWO');
    // A third window joins the new leader.
    const three = await windowOn(app, 'doc-3', '');
    await settle(two, three);
    expect(three.editor.view.state.doc.toString()).toBe(two.editor.view.state.doc.toString());
    type(three.editor, 'Third', ' THREE');
    await settle(two, three);
    const text = two.editor.view.state.doc.toString();
    expect(three.editor.view.state.doc.toString()).toBe(text);
    for (const word of ['ONE', 'TWO', 'THREE']) expect(text).toContain(word);
    expect(parse(text).warnings).toEqual([]);
  });

  it('tells a window that joins what the file holds, not what the session has', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    type(one.editor, 'First', ' UNSAVED');
    await settle(one);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    await wait(30);
    expect(two.editor.view.state.doc.toString()).toContain('UNSAVED');
    expect(two.told).toContain(BASE);
  });

  it('goes on through two handovers in a row with nobody typing in between', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    const three = await windowOn(app, 'doc-3', '');
    await settle(one, two, three);
    type(one.editor, 'First', ' ONE');
    await settle(one, two, three);
    await one.session.stop();
    await wait(40);
    expect(two.session.leading).toBe(true);
    // The first to take over has stored what it replayed, though nobody has typed since.
    await two.session.stop();
    await wait(40);
    expect(three.session.leading).toBe(true);
    expect(three.editor.view.state.doc.toString()).toContain('ONE');
    type(three.editor, 'Third', ' THREE');
    await wait(60);
    const log = app.logs.get(PATH)!;
    expect(log.records.join('')).toContain('ONE');
    expect(log.records.join('')).toContain('THREE');
  });

  it('turns away a call from a window that is not in the session', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    await settle(one);
    const answers: unknown[] = [];
    const stranger = app.ports('doc-9');
    await stranger.listen(EVENTS.reply, (payload) => answers.push(payload));
    await stranger.send('doc-1', EVENTS.call, {
      from: 'doc-9',
      id: 1,
      call: {
        call: 'hello',
        request: {
          credential: { key: 'x' },
          clientID: 'doc-9',
          protocol: 1,
          format: 1,
          version: 0,
          epoch: 1,
        },
      },
    });
    await wait(20);
    expect(JSON.stringify(answers)).toContain('forbidden');
  });

  it('restores what the last run confirmed when its log was left behind', async () => {
    const first = new FakeApp();
    const one = await windowOn(first, 'doc-1', BASE);
    const two = await windowOn(first, 'doc-2', '');
    await settle(one, two);
    type(two.editor, 'Third', ' LOST');
    await settle(one, two);
    // The app crashed before a save: only the log is left.
    const log = first.logs.get(PATH)!;
    expect(log.records.length).toBeGreaterThan(0);
    const next = new FakeApp();
    next.left.set(PATH, log);
    const again = await windowOn(next, 'doc-1', BASE);
    expect(again.editor.view.state.doc.toString()).toContain('LOST');
  });

  it('ignores a log whose base is not the text the window opened', async () => {
    const app = new FakeApp();
    app.left.set(PATH, { base: 'Something else\n', records: [] });
    const one = await windowOn(app, 'doc-1', BASE);
    expect(one.editor.view.state.doc.toString()).toBe(BASE);
  });
});

describe('what the windows are called', () => {
  it('numbers a window by its label, the same whichever window leads', () => {
    expect(windowNumberOf('main')).toBe(1);
    expect(windowNumberOf('doc-1')).toBe(2);
    expect(windowNumberOf('tab-2')).toBe(2);
    expect(windowNumberOf('tab-9f3c1a2b')).toBeNull();
    expect(ordinalOf('main')).toBe(1);
    expect(ordinalOf('doc-1')).toBe(2);
    expect(ordinalOf('doc-12')).toBe(13);
  });

  it('gives each window a name that every window shows it by, through a handover', async () => {
    const app = new FakeApp();
    const peers: Record<string, { name: string }[]> = {};
    const named = async (label: string, doc: string) => {
      const editor = editorFor(doc);
      const session = await joinSession(app.ports(label), editor, {
        path: PATH,
        person: { handle: 'ada', name: 'Ada' },
        save: () => Promise.resolve(editor.view.state.doc.toString()),
        onPeers: (list) => {
          peers[label] = list.map((peer) => ({ name: peer.name }));
        },
        saveDelayMs: 20,
      });
      return { editor, session };
    };
    const one = await named('doc-1', BASE);
    const two = await named('doc-2', '');
    const three = await named('doc-3', '');
    // The windows have the text before anyone points at it.
    await wait(150);
    for (const w of [one, two, three]) w.editor.view.dispatch({ selection: { anchor: 2 } });
    await wait(250);
    expect(peers['doc-1']).toEqual(
      expect.arrayContaining([{ name: 'Ada (window 3)' }, { name: 'Ada (window 4)' }]),
    );
    // The leader closes; the next one hosts. Window 3 is still window 3, in the same color.
    await one.session.stop();
    await wait(400);
    for (const w of [two, three]) w.editor.view.dispatch({ selection: { anchor: 3 } });
    await wait(250);
    expect(peers['doc-2']).toEqual(expect.arrayContaining([{ name: 'Ada (window 4)' }]));
    expect(peers['doc-3']).toEqual(expect.arrayContaining([{ name: 'Ada (window 3)' }]));
  });
});

describe('the authority’s log', () => {
  it('refuses a late write from a leader the app has replaced, and ends the session', async () => {
    const app = new FakeApp();
    const one = await windowOn(app, 'doc-1', BASE);
    const two = await windowOn(app, 'doc-2', '');
    await settle(one, two);
    // The app moves the lead to the other window while this page is frozen.
    const held = app.sessions.get(PATH)!;
    held.leader = 'doc-2';
    held.epoch = 2;
    type(one.editor, 'First', ' LATE');
    await wait(60);
    // Nothing of the late edit is in the log the new leader reads.
    const log = app.logs.get(PATH)!;
    expect(log.records.join('')).not.toContain('LATE');
    expect(one.session.binding.client.state).toBe('ended');
  });

  it('keeps a refusal: every flush after it fails', async () => {
    const ports = {
      walAppend: async () => {
        throw new Error('refused');
      },
    } as unknown as SessionPorts;
    const log = new PortLog(ports, PATH, 1);
    log.append({ kind: 'epoch', epoch: 1 });
    await expect(log.flushed()).rejects.toThrow('refused');
    log.append({ kind: 'epoch', epoch: 2 });
    await expect(log.flushed()).rejects.toThrow('refused');
  });
});
