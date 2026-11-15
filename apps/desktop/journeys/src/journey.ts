// A journey: the desktop page, started with a document in a state, driven as a person drives it.
//
//   import { test, expect } from '../src/journey.ts';
//   test('Tab, then typing at once', async ({ start }) => {
//     const j = await start({ doc: '- one\n- two\n', tracking: false });
//     await j.caretAfter('two');
//     await j.press('Tab');
//     await j.burst('abc');
//     expect(await j.text()).toBe('- one\n  - twoabc\n');
//     await j.shot('after-tab');
//   });
//
// The page is the one `pnpm dev` serves in apps/desktop. It exposes the editor and the document
// controller as `window.__redlines` in development (src/journey-hook.ts), which is how a journey
// loads a document and reads the text and the caret. Everything a person does goes through the real
// keyboard and mouse of the browser, never through the editor's own commands.

import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { shotName, writeShot } from './shots.ts';
import { humanType, type TypingSpeed } from './typing.ts';

export { expect };

export type Scheme = 'light' | 'dark';
export type ViewName = 'clean' | 'simple' | 'redlines' | 'raw';

export interface StartOptions {
  /** The document's text, with its ledger if it has changes. Default: the page's own sample. */
  doc?: string;
  /** Track Changes on or off for this page. Default: as the document says. */
  tracking?: boolean;
  /** The view to show. Default: as the document opens. */
  view?: ViewName;
  /** Overrides the run's color scheme (see `scheme` in the config's `use`). */
  scheme?: Scheme;
  /** Overrides the run's text size, as a multiple of the theme's (1 is 100%, 2 is 200%). */
  textSize?: number;
  /** Shows the word count in the corner. Default: hidden, for a quiet window. */
  wordCount?: boolean;
}

export interface JourneyOptions {
  /** The color scheme the page is drawn in. */
  scheme: Scheme;
  /** The text size: 1 for 100%, 2 for 200%. */
  textSize: number;
}

/** What the page's hook offers, as far as the journeys use it. */
interface Hook {
  editor: {
    view: {
      state: {
        doc: {
          toString(): string;
          length: number;
          lineAt(pos: number): { number: number; from: number; text: string };
        };
        selection: { main: { anchor: number; head: number } };
      };
      contentDOM: HTMLElement;
      coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
      focus(): void;
      requestMeasure(): void;
      dispatch(spec: unknown): void;
    };
    getDoc(): string;
    setTracking(on: boolean, options?: { inFile?: boolean }): unknown;
    setViewMode(mode: string): void;
    getUiState(): Record<string, unknown>;
  };
  controller: { createWith(text: string): Promise<void> };
}

declare global {
  interface Window {
    __redlines?: Hook;
  }
}

export interface Caret {
  /** The selection's anchor and head, as offsets in the document. */
  anchor: number;
  head: number;
  /** The head's line (from 1) and its column (from 0). */
  line: number;
  column: number;
  /** The text of the head's line. */
  lineText: string;
}

export class Journey {
  readonly page: Page;
  readonly info: TestInfo;
  readonly options: JourneyOptions;

  constructor(page: Page, info: TestInfo, options: JourneyOptions) {
    this.page = page;
    this.info = info;
    this.options = options;
  }

  /** The editor's text area. */
  get content(): Locator {
    return this.page.locator('.cm-content');
  }

  // ----- Reading the page -----

  /** The document's text, as the file would hold it. */
  text(): Promise<string> {
    return this.page.evaluate(() => window.__redlines!.editor.getDoc());
  }

  /**
   * The text as CodeMirror holds it, with LF line breaks, which is what offsets (`place`,
   * `caret`) count. It differs from `text()` only in a file with CRLF line breaks.
   */
  cmText(): Promise<string> {
    return this.page.evaluate(() => window.__redlines!.editor.view.state.doc.toString());
  }

  /** What the editor draws, as text: what a person reads, with the markup the view hides gone. */
  drawn(): Promise<string> {
    return this.page.evaluate(() => window.__redlines!.editor.view.contentDOM.innerText);
  }

  /** The editor's selection. */
  caret(): Promise<Caret> {
    return this.page.evaluate(() => {
      const { state } = window.__redlines!.editor.view;
      const { anchor, head } = state.selection.main;
      const line = state.doc.lineAt(head);
      return { anchor, head, line: line.number, column: head - line.from, lineText: line.text };
    });
  }

  /** The text under the selection. */
  async selectedText(): Promise<string> {
    const { anchor, head } = await this.caret();
    return (await this.cmText()).slice(Math.min(anchor, head), Math.max(anchor, head));
  }

  /** The editor's UI state: the view, Track Changes and so on. */
  uiState(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => window.__redlines!.editor.getUiState());
  }

  // ----- Placing the caret and the selection (by the editor, since it's setup, not the journey) -----

  /** Puts the caret at an offset, and focuses the editor. */
  async place(pos: number, head: number = pos): Promise<void> {
    await this.page.evaluate(
      ([anchor, to]) => {
        const { view } = window.__redlines!.editor;
        view.focus();
        view.dispatch({
          selection: { anchor: anchor as number, head: to as number },
          scrollIntoView: true,
        });
      },
      [pos, head],
    );
  }

  /** The offset just after the first `needle` at or after `from`; fails the journey when absent. */
  async offsetAfter(needle: string, from = 0): Promise<number> {
    const at = (await this.cmText()).indexOf(needle, from);
    expect(at, `"${needle}" is in the document`).toBeGreaterThanOrEqual(0);
    return at + needle.length;
  }

  async caretAfter(needle: string, from = 0): Promise<void> {
    await this.place(await this.offsetAfter(needle, from));
  }

  async caretBefore(needle: string, from = 0): Promise<void> {
    await this.place((await this.offsetAfter(needle, from)) - needle.length);
  }

  async caretAtEnd(): Promise<void> {
    await this.place((await this.cmText()).length);
  }

  async caretAtStart(): Promise<void> {
    await this.place(0);
  }

  /** Selects the first `needle` at or after `from`. */
  async selectText(needle: string, from = 0): Promise<void> {
    const end = await this.offsetAfter(needle, from);
    await this.place(end - needle.length, end);
  }

  // ----- Keys and typing -----

  /**
   * Presses keys one after another: 'Tab', 'Shift+Tab', 'Enter', 'ArrowDown'. A shortcut is
   * 'ControlOrMeta+b', which is ⌘B on a Mac and Ctrl-B elsewhere, as the editor's `Mod` is.
   */
  async press(...keys: string[]): Promise<void> {
    for (const key of keys) await this.page.keyboard.press(key);
  }

  /** Types text as a person does, a key every ~70 ms by default. */
  async type(text: string, speed: TypingSpeed = 'human'): Promise<void> {
    await humanType(this.page, text, speed);
  }

  /**
   * Types text in a burst: every key is sent right after the one before it, with no wait for the
   * page to draw. This is what catches letters that come out in the wrong order.
   */
  async burst(text: string): Promise<void> {
    await humanType(this.page, text, 'burst');
  }

  /**
   * A structural key, then typing, with nothing between them: `await j.after('Tab', 'abc')`. The
   * caret and the redraw race here, as a fast typist's do.
   */
  async after(key: string | string[], text: string): Promise<void> {
    for (const k of typeof key === 'string' ? [key] : key) await this.page.keyboard.press(k);
    await humanType(this.page, text, 'burst');
  }

  /**
   * Pastes plain text, and HTML too when given. The event is synthesized (a `paste` ClipboardEvent
   * with the data, sent to the editor, as the browser sends the one a ⌘V makes), so it reaches the
   * editor's paste handling and nothing of the browser's own: there is no `beforeinput`, and a
   * handler that doesn't take the event leaves the document as it was. The journey fails when
   * the editor didn't handle it at all.
   */
  async paste(text: string, html?: string): Promise<void> {
    const handled = await this.page.evaluate(
      ([plain, rich]) => {
        const { view } = window.__redlines!.editor;
        view.focus();
        const data = new DataTransfer();
        data.setData('text/plain', plain as string);
        if (rich) data.setData('text/html', rich);
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(event);
        return event.defaultPrevented;
      },
      [text, html ?? ''],
    );
    expect(handled, 'the editor took the paste').toBe(true);
  }

  // ----- The mouse -----

  /** The page position of a document offset, at the middle of its line. */
  async pointAt(pos: number): Promise<{ x: number; y: number }> {
    const point = await this.page.evaluate((at) => {
      const box = window.__redlines!.editor.view.coordsAtPos(at);
      return box ? { x: box.left, y: (box.top + box.bottom) / 2 } : null;
    }, pos);
    expect(point, `offset ${pos} is drawn`).not.toBeNull();
    return point!;
  }

  /** The page position at the start of the first `needle` (or just after it with `end`). */
  async pointOf(
    needle: string,
    where: 'start' | 'end' = 'start',
  ): Promise<{ x: number; y: number }> {
    const end = await this.offsetAfter(needle);
    return this.pointAt(where === 'end' ? end : end - needle.length);
  }

  /** Clicks where `needle` starts, or on a locator. */
  async click(
    target: string | Locator,
    options: { button?: 'left' | 'right' } = {},
  ): Promise<void> {
    if (typeof target !== 'string') return target.click(options);
    const { x, y } = await this.pointOf(target);
    await this.page.mouse.click(x + 1, y, options);
  }

  async hover(target: string | Locator): Promise<void> {
    if (typeof target !== 'string') return target.hover();
    const { x, y } = await this.pointOf(target);
    await this.page.mouse.move(x + 2, y);
  }

  /** Drags the mouse from one page point to another, in steps, as a hand does. */
  async drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: { steps?: number } = {},
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: options.steps ?? 12 });
    await this.page.mouse.up();
  }

  // ----- Waiting and looking -----

  /** Waits for the page to draw what it has: two frames, and the editor's measuring. */
  async settle(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.__redlines!.editor.view.requestMeasure();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  }

  /**
   * Takes a named screenshot of the window, for the look review: it is written to the run's shots
   * folder (see `shots.ts`) and attached to the report. It is never compared with anything.
   */
  async shot(
    name: string,
    options: { clip?: { x: number; y: number; width: number; height: number } } = {},
  ): Promise<string> {
    await this.settle();
    return writeShot(this.page, this.info, shotName(name, this.options), options);
  }

  /**
   * Compares the window with its approved screenshot, `baselines/<spec file>/<name>.png` (with the
   * look in the name: `-dark`, `-200`), and fails when it differs by more than a little (see the
   * config's `toHaveScreenshot`). A failed run writes the image it got and a diff beside the
   * expected one in the run's output folder. A baseline that doesn't exist fails the journey; the
   * ones to approve are written by `pnpm journeys:accept`, on purpose, and reviewed in the PR. The
   * caret is hidden in it (assert where it is with `caret()`). A name must not be another's with
   * a look added: `a-dark` in the light look is `a` in the dark one.
   * Keep baselines few: the ones that guard a look, not every moment.
   */
  async baseline(
    name: string,
    options: { clip?: { x: number; y: number; width: number; height: number } } = {},
  ): Promise<void> {
    // The picture for the look review too (with the caret, which the comparison hides).
    await this.shot(name, options);
    // CodeMirror draws its caret as an element, which Playwright's own caret hiding doesn't know.
    await this.page.addStyleTag({ content: '.cm-cursorLayer { visibility: hidden !important; }' });
    // A screenshot that has to settle may take longer than the two seconds a person waits.
    await expect(this.page).toHaveScreenshot(`${shotName(name, this.options)}.png`, {
      ...options,
      timeout: 10_000,
    });
  }
}

/**
 * The journeys' test. `start` opens the page with a document in a state and gives a `Journey`; the
 * `scheme` and `textSize` options are the run's look, which a project of the config can change
 * (`defineConfig<JourneyOptions>` and `use: { scheme: 'dark', textSize: 2 }`) and `start` can
 * override. A script error in the page fails the journey.
 */
export type Start = (options?: StartOptions) => Promise<Journey>;

export const test = base.extend<JourneyOptions & { start: Start }>({
  scheme: ['light', { option: true }],
  textSize: [1, { option: true }],
  start: async ({ page, scheme, textSize }, use, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(async (options = {}) => {
      const journey = new Journey(page, testInfo, {
        scheme: options.scheme ?? scheme,
        textSize: options.textSize ?? textSize,
      });
      await openPage(page, journey.options, options);
      return journey;
    });
    expect(errors, 'no script error in the page').toEqual([]);
  },
});

/**
 * A journey that fails today because of an open issue:
 * `known(510, 'pasting a bullet…', /the pasted bullet is its own item/, body)`.
 *
 * The body is run, and its failure is the bug: it must fail with `signature` in its message (give
 * the assertion that shows the bug a message, `expect(x, 'the pasted bullet is its own item')`), so
 * a typo, a timeout or a page error is a failure of the journey, not "the bug". The run is green
 * while the bug stands and goes red when the fix lands ("known bug #510 no longer fails"): then the
 * lane that fixed it changes `known(510, …)` to `test(…)`, and the journey guards the fix.
 * `JOURNEYS_EVIDENCE=1` runs the body as an ordinary test, to show the failure itself.
 */
export function known(
  issue: number,
  title: string,
  signature: RegExp,
  body: (fixtures: { start: Start; page: Page }, info: TestInfo) => Promise<void> | void,
): void {
  const name = `${title} (#${issue})`;
  const details = { annotation: { type: 'issue', description: `#${issue}` } };
  test(name, details, async ({ start, page }, info) => {
    if (process.env['JOURNEYS_EVIDENCE'] === '1') return body({ start, page }, info);
    let failure: unknown;
    try {
      await body({ start, page }, info);
    } catch (error) {
      failure = error;
    }
    if (failure === undefined) {
      throw new Error(`known bug #${issue} no longer fails: change known(${issue}, …) to test(…)`);
    }
    const message = failure instanceof Error ? failure.message : JSON.stringify(failure);
    if (!signature.test(message)) {
      throw new Error(
        `#${issue} failed, but not as the bug does (expected ${String(signature)}):\n${message}`,
      );
    }
  });
}

/** Opens the page in the state asked for, and waits until it is drawn and still. */
async function openPage(page: Page, look: JourneyOptions, options: StartOptions): Promise<void> {
  await page.emulateMedia({ colorScheme: look.scheme, reducedMotion: 'reduce' });
  // The settings the page reads at its start, in its own storage: the look, and a quiet window.
  await page.addInitScript(
    ([scheme, textSize, showWordCount]) => {
      try {
        localStorage.setItem(
          'redlines.settings',
          JSON.stringify({ appearance: scheme, textSize, showWordCount }),
        );
      } catch {
        // A page without storage keeps its defaults.
      }
    },
    [look.scheme, look.textSize, options.wordCount === true] as const,
  );
  // A dev server that has not seen a dependency before reloads the page once when it finds it, which
  // destroys the context under a wait: a start is tried again.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto('/');
      await page.waitForFunction(() => window.__redlines !== undefined, undefined, {
        timeout: 60_000,
      });
      await page.evaluate(() => document.fonts.ready);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  // Nothing moves on its own: no blinking caret and no transitions, so a screenshot is the same twice.
  await page.addStyleTag({
    content: `*, *::before, *::after { transition: none !important; animation: none !important; }`,
  });
  if (options.doc !== undefined) {
    await page.evaluate((text) => window.__redlines!.controller.createWith(text), options.doc);
  }
  if (options.tracking !== undefined) {
    await page.evaluate(
      (on) => window.__redlines!.editor.setTracking(on, { inFile: false }),
      options.tracking,
    );
    // The editor's own state says whether it took (an older editor answered with a boolean).
    const on = await page.evaluate(() => window.__redlines!.editor.getUiState()['tracking']);
    expect(on, `Track Changes switched ${options.tracking ? 'on' : 'off'}`).toBe(options.tracking);
  }
  if (options.view !== undefined) {
    await page.evaluate((view) => window.__redlines!.editor.setViewMode(view), options.view);
  }
  await page.evaluate(() => window.__redlines!.editor.view.focus());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
