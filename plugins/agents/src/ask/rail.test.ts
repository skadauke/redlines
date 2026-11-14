// @vitest-environment happy-dom
import { createEditor, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { createReview, type ReviewController } from '@redlines/review';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeProvider, fakeRelay } from '../fake-provider.ts';
import { createMacAgents } from '../mac-agents.ts';
import { type Ask, createAsk } from './index.ts';

// Ask in the real comment rail: the review interface's rail with its notes, and Ask wired to it
// through `pinToRail`, as the app wires them (apps/desktop/src/main.ts). happy-dom lays nothing
// out, so the notes and the bubble are given their heights and the lines their places, as the
// review's own tests do (plugins/review/src/pin-to-rail.test.ts).

const ada = { handle: 'ada', name: 'Ada Lovelace' };

/** A comment thread of Bo's in a ledger, as YAML lines. */
const thread = (id: string, text: string) => [
  `  ${id}:`,
  '    by: bo',
  '    at: 2026-10-31T09:41Z',
  '    text: |-',
  `      ${text}`,
];

/** A file: `body`, then a ledger of these YAML lines. */
const file = (body: string, ledger: string[]) =>
  `${body}\n\n<!-- redlines\nversion: 1\n${ledger.join('\n')}\n-->\n`;

const PEOPLE = ['people:', '  ada: {name: Ada Lovelace}', '  bo: {name: Bo Chen}'];

/** Five paragraphs, on lines 1, 3, 5, 7 and 9, with a thread on all but the third. */
const DOC = file(
  [
    'One <!--cmt c2dk-->alpha<!--/c2dk-->.',
    'Two <!--cmt c3fm-->beta<!--/c3fm-->.',
    'Three target words.',
    'Four <!--cmt c4gn-->delta<!--/c4gn-->.',
    'Five <!--cmt c5hp-->epsilon<!--/c5hp-->.',
  ].join('\n\n'),
  [
    ...PEOPLE,
    'comments:',
    ...thread('c2dk', 'A'),
    ...thread('c3fm', 'B'),
    ...thread('c4gn', 'D'),
    ...thread('c5hp', 'E'),
  ],
);

/** A file with no comment in it: the rail has no note. */
const NO_NOTES = file('One.\n\nTwo target words.', PEOPLE);

const NOTE = 60;
const GAP = 8;

/** The heights of what happy-dom doesn't lay out: by class, and changed as a test needs. */
const heights: Record<string, number> = { 'rl-note': NOTE, 'rl-qa': 200 };
let originalHeight: PropertyDescriptor | undefined;

const mounted: { editor: Editor; review: ReviewController; ask: Ask }[] = [];

afterEach(() => {
  for (const { editor, review, ask } of mounted.splice(0)) {
    ask.destroy();
    review.destroy();
    editor.destroy();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalHeight);
  originalHeight = undefined;
  heights['rl-qa'] = 200;
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * An editor showing `doc` with the review interface and Ask, in a window wide enough for the rail,
 * whose lines stand 100 px apart from 100 (line 1, 3, 5...), with the notes laid out.
 */
async function mount(doc = DOC) {
  originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const name = Object.keys(heights).find((className) => this.classList.contains(className));
      return name ? (heights[name] ?? 0) : 0;
    },
  });
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada });
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection, in the
  // middle of the update that writes it: the keyboard stays out of the editor here.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  const review = createReview(editor, { author: ada });
  const relay = fakeRelay();
  // An agent that reads the document, and answers.
  const claude = fakeProvider({
    relay,
    script: async function* ({ tools }) {
      await tools.initialize();
      await tools.call('view', {});
      yield { type: 'done', finalText: 'A lien is a claim.' };
    },
  });
  const agents = createMacAgents([claude], relay);
  const ask = createAsk(editor, {
    agents,
    author: ada,
    document: { path: () => '/repo/loan.md', generation: () => 0, read: () => editor.getDoc() },
    projectRoot: () => Promise.resolve({ folder: '/repo', isRepo: true, tooBroad: false }),
    settings: {
      defaultScope: () => 'document',
      consent: () => undefined,
      setConsent: () => {},
    },
    notice: () => {},
    // The app's own wiring.
    pinToRail: (el, anchor, lost) => review.pinToRail(el, anchor, lost),
  });
  mounted.push({ editor, review, ask });
  stubWidth(editor.view.scrollDOM, 1200);
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => {
    const line = editor.view.state.doc.lineAt(pos).number;
    const top = 100 + 100 * ((line - 1) / 2);
    return { left: 0, right: 5, top, bottom: top + 20 };
  });
  // A move of the selection that is on no anchor makes the rail place its notes.
  editor.view.dispatch({ selection: { anchor: 0 } });
  await frame();
  return { editor, review, ask };
}

/** Gives `el` this width, as a layout would. */
function stubWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
}

const notes = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')];
const top = (el: HTMLElement) => parseFloat(el.style.top);
const tops = (editor: Editor) => notes(editor).map(top);
const railOf = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('.rl-rail')!;
const bubble = () => document.querySelector<HTMLElement>('.rl-qa');

/** Selects `text` in the document and opens Ask on it. */
function openAsk(editor: Editor, asking: Ask, text: string): void {
  const from = editor.getDoc().indexOf(text);
  editor.view.dispatch({ selection: { anchor: from, head: from + text.length } });
  expect(asking.start()).toBe(true);
}

/** Whether any two of the boxes, each as `[top, height]`, are closer than the gap or overlap. */
function crowded(boxes: [number, number][]): boolean {
  const sorted = [...boxes].sort((a, b) => a[0] - b[0]);
  return sorted.some(([start, height], i) => {
    const next = sorted[i + 1];
    return next !== undefined && next[0] < start + height + GAP;
  });
}

const boxes = (editor: Editor): [number, number][] => [
  ...tops(editor).map((at): [number, number] => [at, NOTE]),
  ...(bubble() ? [[top(bubble()!), heights['rl-qa'] ?? 0] as [number, number]] : []),
];

function press(key: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('Ask in the comment rail', () => {
  it('is laid out among the notes: the note on its text goes up, the notes below go down, none is covered, and Esc gives them back', async () => {
    const { editor, ask: asking } = await mount();
    const alone = tops(editor);
    expect(alone).toEqual([95, 195, 395, 495]);
    openAsk(editor, asking, 'delta');
    await frame();
    const el = bubble()!;
    // The rail laid it out, as it does a new comment's box: level with the selection (400, raised
    // by 5), at the rail's left, and Ask placed nothing.
    expect(el.classList).toContain('rl-qa-railed');
    expect(top(el)).toBe(395);
    expect(el.style.left).not.toBe('');
    expect(el.style.left).toBe(railOf(editor).style.left);
    // Delta's note, on the same text, went above it, and epsilon's below it; alpha and beta had
    // room already.
    expect(tops(editor)).toEqual([95, 195, 395 - GAP - NOTE, 395 + 200 + GAP]);
    expect(crowded(boxes(editor))).toBe(false);
    // Esc closes it, and the notes are where they were.
    press('Escape');
    await frame();
    expect(bubble()).toBeNull();
    expect(tops(editor)).toEqual(alone);
  });

  it('pushes down the notes below the selection, for the height it has, and again as it grows', async () => {
    const { editor, ask: asking } = await mount();
    openAsk(editor, asking, 'target');
    await frame();
    // The selection is on line 5 (300, raised by 5): delta and epsilon below it go down.
    expect(top(bubble()!)).toBe(295);
    expect(tops(editor)).toEqual([95, 195, 295 + 200 + GAP, 295 + 200 + GAP + NOTE + GAP]);
    // The answer makes it taller; the rail is told, and lays the notes out again.
    heights['rl-qa'] = 320;
    document.querySelector<HTMLTextAreaElement>('.rl-qa textarea')!.value = 'What is a lien?';
    document
      .querySelector<HTMLTextAreaElement>('.rl-qa textarea')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    await vi.waitFor(() => expect(document.querySelector('.rl-qa-answer')).not.toBeNull(), {
      timeout: 2000,
    });
    await frame();
    expect(tops(editor)).toEqual([95, 195, 295 + 320 + GAP, 295 + 320 + GAP + NOTE + GAP]);
    expect(crowded(boxes(editor))).toBe(false);
  });

  it('is open through a press on a note it pushed aside, and the click on Resolve lands', async () => {
    const { editor, ask: asking } = await mount();
    openAsk(editor, asking, 'delta');
    await frame();
    // Epsilon's note went below the bubble, away from its text at 495.
    const epsilon = notes(editor)[3]!;
    expect(top(epsilon)).toBe(395 + 200 + GAP);
    const resolve = [...epsilon.querySelectorAll('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Resolve',
    )!;
    const resolved = () =>
      parse(editor.getDoc()).ledger.comments.find(({ id }) => id === 'c5hp')?.resolved;
    resolve.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    resolve.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // The press moved nothing: the bubble is open and held, and the notes stay where they were,
    // so that the release is over the same button.
    await frame();
    expect(bubble()).not.toBeNull();
    expect(tops(editor)).toEqual([95, 195, 395 - GAP - NOTE, 395 + 200 + GAP]);
    resolve.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    resolve.click();
    // The note heard its click, which resolved its thread, and the bubble goes after it.
    expect(resolved()).toBeDefined();
    expect(bubble()).not.toBeNull();
    await tick();
    expect(bubble()).toBeNull();
    await frame();
    // Epsilon's note is gone with its thread (resolved comments are hidden), and the rest are back
    // at their texts.
    expect(tops(editor)).toEqual([95, 195, 395]);
  });

  describe('where the rail shows no note in full', () => {
    /** The bubble was hung by Ask, by the selection, and the rail laid out nothing. */
    const hungByAsk = () => {
      expect(bubble()).not.toBeNull();
      expect(bubble()!.classList).not.toContain('rl-qa-railed');
      expect(bubble()!.style.left).not.toBe('');
      expect(bubble()!.style.top).not.toBe('');
    };

    it('hangs by the selection in Clean, where the rail has no note', async () => {
      const { editor, ask: asking } = await mount();
      editor.setViewMode('clean');
      await frame();
      expect(notes(editor)).toHaveLength(0);
      openAsk(editor, asking, 'delta');
      await frame();
      hungByAsk();
      // Redlines again: the rail shows its notes, and at the next layout Ask finds it taking the
      // bubble.
      editor.setViewMode('redlines');
      await frame();
      window.dispatchEvent(new Event('resize'));
      await frame();
      expect(bubble()!.classList).toContain('rl-qa-railed');
      expect(tops(editor)).toEqual([95, 195, 395 - GAP - NOTE, 395 + 200 + GAP]);
    });

    it('hangs by the selection in a narrow editor, where the notes are dots', async () => {
      const { editor, ask: asking } = await mount();
      stubWidth(editor.view.scrollDOM, 700);
      editor.view.dispatch({ selection: { anchor: 1 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).toContain('rl-rail-compact');
      openAsk(editor, asking, 'delta');
      await frame();
      hungByAsk();
    });

    it('hangs by the selection in a document with no comment, and the column keeps its width', async () => {
      const { editor, ask: asking } = await mount(NO_NOTES);
      expect(editor.view.dom.classList).not.toContain('rl-has-rail');
      openAsk(editor, asking, 'target');
      await frame();
      hungByAsk();
      expect(editor.view.dom.classList).not.toContain('rl-has-rail');
    });

    it('hangs by the selection when the editor turns narrow, and is laid out again when it is wide', async () => {
      const { editor, ask: asking } = await mount();
      openAsk(editor, asking, 'delta');
      await frame();
      expect(bubble()!.classList).toContain('rl-qa-railed');
      // The editor turns narrow: the rail shows dots, lets go of the bubble and says so, and Ask
      // hangs the bubble by the selection itself.
      stubWidth(editor.view.scrollDOM, 700);
      editor.view.dispatch({ selection: { anchor: 1 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).toContain('rl-rail-compact');
      hungByAsk();
      // Wide again: the rail shows its notes, and at the next layout Ask finds it taking the bubble.
      stubWidth(editor.view.scrollDOM, 1200);
      editor.view.dispatch({ selection: { anchor: 2 } });
      await frame();
      await tick();
      expect(railOf(editor).classList).not.toContain('rl-rail-compact');
      window.dispatchEvent(new Event('resize'));
      await frame();
      expect(bubble()!.classList).toContain('rl-qa-railed');
      expect(top(bubble()!)).toBe(395);
      expect(tops(editor)).toEqual([95, 195, 395 - GAP - NOTE, 395 + 200 + GAP]);
      expect(crowded(boxes(editor))).toBe(false);
    });
  });

  it('stays level with its text when a new comment is written too, whose box is placed around it', async () => {
    const { editor, review, ask: asking } = await mount();
    openAsk(editor, asking, 'target');
    await frame();
    const from = editor.getDoc().indexOf('delta');
    editor.view.dispatch({ selection: { anchor: from, head: from + 5 } });
    expect(review.startComment()).toBe(true);
    await frame();
    expect(notes(editor)).toHaveLength(5);
    expect(top(bubble()!)).toBe(295);
    expect(crowded(boxes(editor))).toBe(false);
    // Esc closes the bubble, and the box is level with its own text.
    press('Escape');
    await frame();
    expect(bubble()).toBeNull();
    expect(crowded(boxes(editor))).toBe(false);
  });
});
