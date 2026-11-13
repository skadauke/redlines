// Debug only: checks the formatting palette and Ask in WebKit, where happy-dom can't: the right-click
// through real layout (the palette at the pointer, inside the window, WebKit's own menu held back),
// the hover hint, the handle at the bottom center, and, with the page's scripted agent
// (`dev-agents.ts`), Ask's bubble: where it hangs, the first-run question, the answer with its
// citation, Make Comment and Esc. Serve the page with `VITE_PALETTE_CHECK=1 pnpm dev` and open it
// in WebKit: it reads nothing in a release build. Each check reports one console line,
// `PALETTE-CHECK <name> pass` or `PALETTE-CHECK <name> FAIL <json>`, then
// `PALETTE-CHECK done <passed> passed, <failed> failed`.
//
// It leaves `window.__REDLINES_PALETTE__ = { run }` on the page, to run the checks again by hand.
// A real agent, the native menu's absence and the clipboard (a gesture of the person's) are for a
// person to try in the app (the steps are in the pull request).

import type { Editor } from '@redlines/editor';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * An element's box where it rests. The palette rises 2 px as it appears, and a page that isn't
 * drawing frames yet (a busy machine, a window out of sight) still has it at the start: the
 * animation is put out while the box is read, and put back.
 */
function atRest(el: HTMLElement | null | undefined): DOMRect | null {
  if (!el) return null;
  const was = el.style.animation;
  el.style.animation = 'none';
  const rect = el.getBoundingClientRect();
  el.style.animation = was;
  return rect;
}

/** Waits until `test` gives something, for at most `ms`. */
async function waitFor<T>(test: () => T | null | undefined | false, ms = 4000): Promise<T | null> {
  for (let waited = 0; waited < ms; waited += 25) {
    const found = test();
    if (found) return found;
    await sleep(25);
  }
  return null;
}

const query = <T extends Element>(selector: string) => document.querySelector<T>(selector);

/** A box as plain numbers, which a console line can say. */
const plain = (rect: DOMRect | null | undefined) =>
  rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;

export interface PaletteCheckOptions {
  /** Whether the page has the scripted agent, so that an Ask can be answered. */
  ask: boolean;
}

async function checks(
  editor: Editor,
  options: PaletteCheckOptions,
): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const report = (name: string, ok: boolean, detail: unknown = null) => {
    if (ok) passed++;
    else failed++;
    console.log(`PALETTE-CHECK ${name} ${ok ? 'pass' : `FAIL ${JSON.stringify(detail)}`}`);
  };
  const { view } = editor;
  const content = view.contentDOM;
  /** The range of `text` in the line that starts with `line`, in whichever of its text nodes it is. */
  const word = (text: string, line: string) => {
    const el = [...content.querySelectorAll('.cm-line')].find((l) =>
      l.textContent?.startsWith(line),
    );
    if (!el) throw new Error(`No line "${line}"`);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      return range;
    }
    throw new Error(`No "${text}" in the line "${line}"`);
  };
  const rightClick = (x: number, y: number) => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 2,
      buttons: 2,
    });
    content.dispatchEvent(event);
    return event;
  };
  const escape = () =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  const inWindow = (rect: DOMRect) =>
    rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;

  // The right-click: WebKit's menu is held back, and the palette is at the pointer.
  const target = word('comments', 'Redlines shows').getBoundingClientRect();
  const at = { x: Math.round(target.left + 10), y: Math.round(target.top + target.height / 2) };
  const event = rightClick(at.x, at.y);
  await sleep(150);
  const palette = query<HTMLElement>('.rl-palette');
  const rect = atRest(palette);
  report('right-click-is-the-palette', event.defaultPrevented && palette?.hidden === false, {
    prevented: event.defaultPrevented,
    hidden: palette?.hidden,
  });
  report(
    'palette-is-at-the-pointer-and-in-the-window',
    !!rect && Math.abs(rect.left - at.x) <= 1 && Math.abs(rect.top - at.y) <= 1 && inWindow(rect),
    { at, rect: plain(rect) },
  );
  report(
    'right-click-selects-the-word',
    view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) ===
      'comments',
    view.state.selection.main,
  );
  const items = [...(palette?.querySelectorAll<HTMLElement>('.rl-palette-item') ?? [])];
  const commands = items.map((item) => item.dataset['command']);
  report(
    'items-are-the-registry-commands',
    ['comment.add', 'block.table', 'format.bold', 'format.italic', 'edit.paste'].every((id) =>
      commands.includes(id),
    ) && items.every((item) => item.textContent === '' && !!item.getAttribute('aria-label')),
    commands,
  );

  // The hint comes after the delay, with the name and the keys.
  const bold = palette?.querySelector<HTMLElement>('[data-command="format.bold"]');
  bold?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }));
  await sleep(250);
  const early = query<HTMLElement>('.rl-palette-tip')?.hidden;
  await sleep(300);
  const tip = query<HTMLElement>('.rl-palette-tip');
  report(
    'hint-comes-after-the-delay',
    early === true && tip?.hidden === false && tip.textContent === 'Bold⌘B',
    {
      early,
      text: tip?.textContent,
    },
  );
  escape();
  await sleep(50);
  report('esc-closes-the-palette', query<HTMLElement>('.rl-palette')?.hidden === true);

  // The handle: at the bottom center, hover brings the palette up above it, leaving puts it away.
  const handle = query<HTMLElement>('.rl-palette-handle');
  const hr = handle?.getBoundingClientRect();
  report(
    'handle-is-at-the-bottom-center',
    !!hr &&
      Math.abs(hr.left + hr.width / 2 - innerWidth / 2) < 2 &&
      Math.abs(hr.bottom - innerHeight) < 2,
    plain(hr),
  );
  handle?.dispatchEvent(
    new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse', buttons: 0 }),
  );
  await sleep(300);
  const up = query<HTMLElement>('.rl-palette');
  const ur = atRest(up);
  report(
    'hover-brings-the-palette-up-above-the-handle',
    up?.hidden === false &&
      !!ur &&
      !!hr &&
      ur.bottom <= hr.top &&
      Math.abs(ur.left + ur.width / 2 - innerWidth / 2) < 3,
    { palette: plain(ur), handle: plain(hr) },
  );
  handle?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' }));
  await sleep(400);
  report('leaving-puts-it-away', query<HTMLElement>('.rl-palette')?.hidden === true);

  if (!options.ask) {
    console.log('PALETTE-CHECK ask skipped: no scripted agent on this page');
  } else {
    // Ask from the palette, on a selected word.
    const range = word('every', 'Redlines shows');
    content.focus();
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    await sleep(100);
    const box = range.getBoundingClientRect();
    rightClick(Math.round(box.left + 10), Math.round(box.top + 5));
    await sleep(150);
    query<HTMLElement>('.rl-palette-item[data-command="ask.start"]')?.click();
    await sleep(150);
    const bubble = query<HTMLElement>('.rl-qa');
    const field = bubble?.querySelector('textarea');
    const br = bubble?.getBoundingClientRect();
    report(
      'ask-opens-in-the-window-with-the-keyboard-in-its-box',
      !!br && inWindow(br) && document.activeElement === field,
      {
        bubble: plain(br),
        focused: document.activeElement === field,
      },
    );
    report(
      'ask-tints-its-selection',
      query('.rl-qa-target')?.textContent === 'every',
      query('.rl-qa-target')?.textContent,
    );
    const column = content.getBoundingClientRect();
    report(
      'ask-hangs-beside-the-text-column',
      !!br && br.left >= column.left && br.top <= box.top + 4 && br.top >= box.top - 40,
      {
        bubble: plain(br),
        selection: plain(box),
      },
    );

    if (field) {
      field.value = 'What does this mean?';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    }
    const allow = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>('.rl-ask-answers button')].find(
          (b) => b.textContent === 'Just This Document',
        ),
      1500,
    );
    if (allow) {
      report(
        'first-run-question-says-it-changes-nothing',
        /changes nothing/.test(query('.rl-ask-note')?.textContent ?? ''),
        query('.rl-ask-note')?.textContent,
      );
      allow.click();
    }
    const answer = await waitFor(() => query<HTMLElement>('.rl-qa-answer'), 6000);
    await sleep(150);
    const cite = query<HTMLButtonElement>('.rl-qa-answer p .rl-qa-cite');
    report(
      'answer-has-a-citation-link-and-the-actions',
      !!answer &&
        !!cite &&
        ['Make Comment', 'Copy'].every((name) => !!query(`.rl-qa-actions [aria-label="${name}"]`)),
      {
        text: answer?.textContent?.slice(0, 80),
        actions: [...document.querySelectorAll('.rl-qa-actions button')].map((b) =>
          b.getAttribute('aria-label'),
        ),
      },
    );
    report(
      'keyboard-is-in-the-follow-up-field',
      document.activeElement === field && field?.placeholder === 'Ask a follow-up',
      field?.placeholder,
    );
    cite?.click();
    await sleep(150);
    const { from, to } = view.state.selection.main;
    report(
      'citation-selects-the-passage',
      view.state.sliceDoc(from, to).startsWith('Redlines shows every change'),
      view.state.sliceDoc(from, to),
    );
    const before = editor.getDoc();
    query<HTMLButtonElement>('.rl-qa-actions [aria-label="Make Comment"]')?.click();
    await sleep(300);
    report(
      'make-comment-makes-a-thread-and-closes-the-bubble',
      !query('.rl-qa') &&
        editor.getParsed().ledger.comments.length > 0 &&
        editor.getDoc() !== before,
      editor.getParsed().ledger.comments.length,
    );
    editor.undo();
    await sleep(100);
    report('one-undo-takes-the-thread-back', editor.getDoc() === before);

    // Esc closes a bubble, and nothing was written to the file by asking.
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(word('shows', 'Redlines shows'));
    await sleep(100);
    const written = editor.getDoc();
    editor.commands.run('ask.start');
    await sleep(100);
    report('ask-opens-again-from-the-command', !!query('.rl-qa'));
    escape();
    await sleep(100);
    report(
      'esc-closes-ask-and-the-keyboard-returns-to-the-text',
      !query('.rl-qa') &&
        !query('.rl-qa-target') &&
        document.activeElement === content &&
        editor.getDoc() === written,
    );
  }

  console.log(`PALETTE-CHECK done ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/** What the last run was given, for `__REDLINES_PALETTE__.run()` to run again with. */
let last: { editor: Editor; options: PaletteCheckOptions } | null = null;

export async function runPaletteCheck(
  editor: Editor,
  options: PaletteCheckOptions,
): Promise<{ passed: number; failed: number }> {
  last = { editor, options };
  try {
    return await checks(editor, options);
  } catch (error) {
    // A check that can't run is a failure, and the run still says it is done.
    console.log(`PALETTE-CHECK crashed FAIL ${JSON.stringify(String(error))}`);
    console.log('PALETTE-CHECK done 0 passed, 1 failed');
    return { passed: 0, failed: 1 };
  }
}

// To run the checks again by hand, in the console: `await __REDLINES_PALETTE__.run()`.
(window as unknown as Record<string, unknown>)['__REDLINES_PALETTE__'] = {
  run: () =>
    last
      ? runPaletteCheck(last.editor, last.options)
      : Promise.reject(new Error('The check has not started yet.')),
};
