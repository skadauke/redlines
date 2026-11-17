// Debug only: checks one document in two windows in WebKit, where happy-dom can't: two editors side
// by side in real layout, typing into each through the browser's own input path
// (`execCommand('insertText')`, which reaches CodeMirror as a real `beforeinput`), both joined to
// one authority by the same transport the windows of the app use over events. Serve the page with
// `VITE_SYNC_CHECK=1 pnpm dev` (or open `/?sync-check` on a dev page, as the journey does) in WebKit:
// it reads nothing in a release build. Each
// check reports one console line, `SYNC-CHECK <name> pass` or `SYNC-CHECK <name> FAIL <json>`, then
// `SYNC-CHECK done <passed> passed, <failed> failed`.
//
// It leaves the two windows on the page, side by side, for a screenshot, and
// `window.__REDLINES_SYNC__ = { left, right, hub, run }` to ask by hand.

import { Authority, Hub, memoryTransport } from '@redlines/collab';
import type { Identity } from '@redlines/collab';
import { createEditor } from '@redlines/editor';
import type { Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { syncEditor, type SyncBinding } from '@redlines/sync';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(test: () => boolean, ms = 4000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 10) {
    if (test()) return true;
    await sleep(10);
  }
  return test();
}

const DOCUMENT = [
  '# Two windows',
  '',
  'The first paragraph is for Ada to edit while Bo works further down the page.',
  '',
  'The second paragraph is where both of them type at once, one word apart.',
  '',
  'The third paragraph is Bo’s.',
  '',
].join('\n');

const PEOPLE: Record<string, Identity> = {
  ada: { handle: 'ada', name: 'Ada Lovelace', role: 'owner' },
  bo: { handle: 'bo', name: 'Bo Chen', role: 'editor' },
};

interface Pane {
  editor: Editor;
  binding: SyncBinding;
}

function pane(host: HTMLElement, who: 'ada' | 'bo', hub: Hub, hosts: boolean): Pane {
  const holder = document.createElement('div');
  holder.style.cssText = 'flex:1 1 0;min-width:0;overflow:auto;padding:0 8px;';
  const label = document.createElement('div');
  label.textContent = who === 'ada' ? 'Ada’s window' : 'Bo’s window';
  label.style.cssText =
    'font-family:system-ui;font-size:var(--rl-size-ui);color:#666;padding:6px 0;';
  const mount = document.createElement('div');
  holder.append(label, mount);
  host.append(holder);
  const editor = createEditor(mount, {
    doc: hosts ? DOCUMENT : '',
    author: { handle: who, name: PEOPLE[who]!.name },
  });
  const binding = syncEditor(editor, {
    transport: memoryTransport(hub, `${who}-1`),
    clientID: `${who}-1`,
    credential: { key: who },
    hosts,
  });
  return { editor, binding };
}

/** Types `text` at the end of the first line that holds `after`, through the browser's input. */
function typeAfter(editor: Editor, after: string, text: string): void {
  const doc = editor.view.state.doc.toString();
  const at = doc.indexOf(after) + after.length;
  editor.focus();
  editor.view.dispatch({ selection: { anchor: at } });
  document.execCommand('insertText', false, text);
}

export async function runSyncCheck(): Promise<void> {
  let passed = 0;
  let failed = 0;
  const report = (name: string, ok: boolean, detail: unknown = null) => {
    if (ok) passed++;
    else failed++;
    console.log(`SYNC-CHECK ${name} ${ok ? 'pass' : `FAIL ${JSON.stringify(detail)}`}`);
  };

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;gap:12px;background:var(--rl-bg,#fff);';
  document.body.append(host);
  const authority = new Authority({
    base: DOCUMENT,
    authenticate: (credential) =>
      'key' in credential
        ? (PEOPLE[credential.key] ?? { error: 'forbidden' })
        : { error: 'forbidden' },
  });
  const hub = new Hub(authority);
  const left = pane(host, 'ada', hub, true);
  const right = pane(host, 'bo', hub, false);
  const settled = async () => {
    await Promise.all([left.binding.settled(), right.binding.settled()]);
    return waitFor(
      () =>
        left.binding.replica.pending.length === 0 &&
        right.binding.replica.pending.length === 0 &&
        left.binding.replica.version === right.binding.replica.version &&
        left.binding.replica.version === authority.version,
    );
  };
  Object.assign(window, { __REDLINES_SYNC__: { left, right, hub, run: runSyncCheck } });

  const joined = await waitFor(() => right.editor.view.state.doc.toString() === DOCUMENT);
  report('the second window shows the first one’s text', joined);
  left.editor.setTracking(true, { inFile: false });
  right.editor.setTracking(true, { inFile: false });

  // Both type at once, in different paragraphs.
  typeAfter(left.editor, 'for Ada to edit', ' ADA');
  typeAfter(right.editor, 'is Bo’s', ' BO');
  const ok = await settled();
  const text = authority.text;
  report(
    'typing at once in different places converges',
    ok &&
      left.editor.view.state.doc.toString() === text &&
      right.editor.view.state.doc.toString() === text &&
      text.includes(' ADA') &&
      text.includes(' BO') &&
      parse(text).warnings.length === 0,
    { text },
  );

  // Both type at the same place at once: neither is lost, the markup stays valid.
  typeAfter(left.editor, 'where both of them', ' (ada)');
  typeAfter(right.editor, 'where both of them', ' (bo)');
  const again = await settled();
  const both = authority.text;
  report(
    'typing at the same place at once keeps both and the markup valid',
    again &&
      left.editor.view.state.doc.toString() === both &&
      right.editor.view.state.doc.toString() === both &&
      both.includes('(ada)') &&
      both.includes('(bo)') &&
      parse(both).warnings.length === 0,
    { both },
  );

  // A caret stays where it was, among the same words, through another window's edit.
  const rightDoc = () => right.editor.view.state.doc.toString();
  const anchor = rightDoc().indexOf('further down');
  right.editor.view.dispatch({ selection: { anchor } });
  typeAfter(left.editor, '# Two', 's');
  await settled();
  report(
    'a caret keeps its place among the words through the other window’s edit',
    rightDoc().indexOf('further down') === right.editor.view.state.selection.main.head - 0 ||
      rightDoc().slice(right.editor.view.state.selection.main.head).startsWith('further down'),
    { head: right.editor.view.state.selection.main.head },
  );

  // How long a keystroke takes to show in the other window.
  const started = performance.now();
  typeAfter(left.editor, 'The third', 'x');
  const shown = await waitFor(
    () => rightDoc().includes('The thirdx') || /third.*x/.test(rightDoc()),
  );
  const latency = performance.now() - started;
  report('a keystroke shows in the other window within 250 ms', shown && latency < 250, {
    latency: Math.round(latency),
  });

  await settled();
  report(
    'the markup of every window is the authority’s, and valid',
    left.editor.view.state.doc.toString() === authority.text &&
      right.editor.view.state.doc.toString() === authority.text &&
      parse(authority.text).warnings.length === 0,
  );
  console.log(`SYNC-CHECK done ${passed} passed, ${failed} failed`);
}
