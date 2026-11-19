// Debug only: the sheet of every interface element (#1208). It opens a document that holds what the
// editor draws as an element (a picture, a table, a callout, an HTML block, a tracked insertion,
// deletion and comment), puts up the notifications the app has, and leaves the page for a person or
// for the journey (apps/desktop/journeys/tests/sheet.spec.ts) to take through the states: at rest,
// hovered, chosen with the keys, selected, dragged, in every look and theme. Serve the page with
// `VITE_SHEET_CHECK=1 pnpm dev` (or open `/?sheet-check` on a dev page) in WebKit: it reads nothing
// in a release build.
//
// It draws no copy of anything: every element is the one the app draws, so that the sheet and the
// app can't disagree. Each check reports one console line, `SHEET-CHECK <name> pass` or
// `SHEET-CHECK <name> FAIL <json>`, then `SHEET-CHECK done <passed> passed, <failed> failed`. The
// checks here are that every element of the sheet is there; that siblings agree in their styles is
// the journey's (it needs real hovers, key presses and drags, which a page can't make).
//
// It leaves `window.__REDLINES_SHEET__ = { prepare, notify }` on the page.

import type { Editor } from '@redlines/editor';
import type { Notification, NotificationOptions } from './ui/notifications.ts';

/** The document of the sheet: one of each thing the editor draws as an element. */
export const SHEET_DOC = `# The sheet

A paragraph with a <!--cmt c3k9-->commented word<!--/c3k9-->, an <!--ins k3x9-->insertion<!--/k3x9--> and <!--del m2bd a deletion-->.

![A red square](sheet.png)

| A | B |
| - | - |
| 1 | 2 |
| 3 | 4 |

> [!NOTE]
> A callout.

<div class="sheet">An HTML block</div>

<!-- redlines
version: 1
people:
  ada: {name: Ada}
marks:
  k3x9: {by: ada, at: 2026-11-18T02:58Z}
  m2bd: {by: ada, at: 2026-11-18T02:58Z}
comments:
  c3k9:
    by: ada
    at: 2026-11-18T02:58Z
    quote: |-
      commented word
    text: |-
      Is this right?
-->
`;

/** What the sheet has at rest, by the selector that finds it: each must be on the page. */
export const SHEET_PARTS: readonly [name: string, selector: string][] = [
  ['picture', '.rl-image img'],
  ['picture handle', '.rl-image-handle'],
  ['table', '.rl-tbl'],
  ['callout', '.rl-callout'],
  ['HTML block', '.rl-html-block'],
  ['tracked insertion', '.rl-ins'],
  ['tracked deletion', '.rl-del'],
  ['comment note', '.rl-note'],
  ['change bar', '.rl-bar-seg'],
  ['title bar button', '.rl-icon-button'],
  ['notification', '.rl-notification'],
  ['notification action', '.rl-notification-buttons button'],
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The picture of the sheet: a flat square, saved as the page's own file. */
async function savePicture(): Promise<void> {
  const files = (
    window as unknown as {
      __redlinesImages?: { replace(path: string, blob: Blob): void };
    }
  ).__redlinesImages;
  if (!files) return;
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 200;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#c0392b';
  context.fillRect(0, 0, 400, 200);
  const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
  files.replace('sheet.png', blob);
}

/** Opens the sheet's document, and waits until its picture is drawn. */
export async function prepareSheet(editor: Editor): Promise<void> {
  await savePicture();
  editor.setTracking(false, { inFile: false });
  editor.setViewMode('redlines');
  editor.setDoc(SHEET_DOC);
  for (let waited = 0; waited < 4000; waited += 25) {
    const img = document.querySelector<HTMLImageElement>('.rl-image img');
    if (img && img.getBoundingClientRect().width > 50) return;
    await sleep(25);
  }
}

/** Every kind of notification the app has: a line, one with an action, and one with two buttons. */
export function showSheetNotifications(
  show: (options: NotificationOptions) => Notification,
): Notification[] {
  return [
    show({ text: 'Exported to “Plan.docx”.', key: 'sheet-1' }),
    show({
      text: 'A new version of Redlines is ready.',
      action: { label: 'Restart', run: () => undefined },
      dismissLabel: 'Later',
      key: 'sheet-2',
    }),
    show({
      text: 'An agent asks to read “Notes.md”.',
      action: { label: 'Allow Always', run: () => undefined },
      secondaryAction: { label: 'Allow Once', run: () => undefined },
      key: 'sheet-3',
    }),
  ];
}

export interface SheetCheckOptions {
  /** The app's notifications. */
  notify: (options: NotificationOptions) => Notification;
}

let last: { editor: Editor; options: SheetCheckOptions } | null = null;

export async function runSheetCheck(
  editor: Editor,
  options: SheetCheckOptions,
): Promise<{ passed: number; failed: number }> {
  last = { editor, options };
  let passed = 0;
  let failed = 0;
  try {
    await prepareSheet(editor);
    showSheetNotifications(options.notify);
    await sleep(200);
    // The picture's handles are drawn while the pointer is over it, and the table's grips while it
    // is over a cell: only what is there at rest is looked for here.
    for (const [name, selector] of SHEET_PARTS) {
      const found = document.querySelector(selector) !== null;
      if (found) passed++;
      else failed++;
      console.log(`SHEET-CHECK ${name} ${found ? 'pass' : `FAIL ${JSON.stringify(selector)}`}`);
    }
  } catch (error) {
    failed++;
    console.log(`SHEET-CHECK crashed FAIL ${JSON.stringify(String(error))}`);
  }
  console.log(`SHEET-CHECK done ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// To draw the sheet again by hand, in the console: `await __REDLINES_SHEET__.run()`; `notify()`
// puts the notifications up again (Esc takes them away).
(window as unknown as Record<string, unknown>)['__REDLINES_SHEET__'] = {
  notify: () => (last ? showSheetNotifications(last.options.notify) : []),
  run: () =>
    last
      ? runSheetCheck(last.editor, last.options)
      : Promise.reject(new Error('The check has not started yet.')),
};
