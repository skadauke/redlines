// Long documents scrolled the way a person scrolls them (#695): open, drag the scrollbar to the
// middle, then to the end, scroll back up with the wheel, and press Page Down through a stretch.
// Each phase is measured (the longest stall of the page, the frames, the browser's memory) and held
// to a budget, and the end of the document must read exactly right.
//
// This is the long tier: it runs on main (`JOURNEYS_LONG=1`, see playwright.config.ts), not on a pull
// request, because a 5 MB document takes a minute. `JOURNEYS_LONG=1 pnpm journeys tests/long-documents.spec.ts`.
// The numbers are printed (and attached to the report) on every run; `JOURNEYS_BUDGETS=off` keeps
// the assertions on the text and drops the budgets, to measure a build that is over them.

import { expect, test, type Journey } from '../src/journey.ts';
import { END_OF_DOCUMENT, longLinesDocument, ordinaryDocument } from '../src/long-docs.ts';
import { dragScrollbarTo, formatPhases, measure, startMonitor, type Phase } from '../src/stalls.ts';

interface Budget {
  /** The longest stall of the page's main thread in any phase, ms. */
  stall: number;
  /** The longest gap between two frames in any phase, ms. */
  frame: number;
  /** The browser's resident memory at any point, MB. */
  memoryMB: number;
  /** Opening the document, to the first drawn frame, ms. */
  open: number;
}

const enforce = process.env['JOURNEYS_BUDGETS'] !== 'off';

async function journey(
  label: string,
  doc: string,
  budget: Budget,
  start: (options: { doc: string }) => Promise<Journey>,
): Promise<void> {
  const opened = Date.now();
  const j = await start({ doc });
  await j.settle();
  const openMs = Date.now() - opened;
  await startMonitor(j.page);
  const phases: Phase[] = [];
  const record = async (name: string, body: () => Promise<void>) => {
    const phase = await measure(j.page, name, body);
    phases.push(phase);
    console.log(formatPhases(label, [phase]));
  };
  await record('to the middle', () => dragScrollbarTo(j.page, 0.5));
  // How long after the drag the end is on the screen (a page that stays blank is the worst stall).
  let blankMs = 0;
  await record('to the end', async () => {
    await dragScrollbarTo(j.page, 1);
    blankMs = await j.page.evaluate(
      (needle) =>
        new Promise<number>((resolve) => {
          const started = performance.now();
          const look = () => {
            const { view } = window.__redlines!.editor;
            const drawn = view.viewport.to >= view.state.doc.length - needle.length;
            if (drawn || performance.now() - started > 15_000) resolve(performance.now() - started);
            else requestAnimationFrame(look);
          };
          look();
        }),
      END_OF_DOCUMENT,
    );
  });
  console.log(`${label} | end drawn ${Math.round(blankMs)} ms after the drag`);
  const atEnd = await j.drawn();
  await j.shot(`${label}-end`);
  await record('scroll up', async () => {
    await j.page.mouse.move(640, 400);
    for (let i = 0; i < 25; i++) {
      await j.page.mouse.wheel(0, -700);
      await j.page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    await j.settle();
  });
  const scrollTop = () =>
    j.page.evaluate(() => (document.querySelector('.rl-scroller') as HTMLElement).scrollTop);
  const pageDown = { before: 0, after: 0 };
  await record('page down', async () => {
    const length = await j.page.evaluate(() => window.__redlines!.editor.view.state.doc.length);
    await j.place(Math.floor(length * 0.4));
    pageDown.before = await scrollTop();
    for (let i = 0; i < 20; i++) await j.press('PageDown');
    await j.settle();
    pageDown.after = await scrollTop();
  });

  const report = `${formatPhases(label, phases)}\nopen ${openMs} ms`;
  console.log(`${label} | open ${openMs} ms`);
  await test.info().attach(`${label}-numbers`, { body: report, contentType: 'text/plain' });

  expect(pageDown.after, 'Page Down moved down the document').toBeGreaterThan(pageDown.before);

  if (enforce) {
    expect(openMs, 'opening').toBeLessThan(budget.open);
    for (const p of phases) {
      expect(p.longestStall, `${p.name}: the longest stall`).toBeLessThan(budget.stall);
      expect(p.frameMax, `${p.name}: the longest frame`).toBeLessThan(budget.frame);
      if (p.memoryMB !== null)
        expect(p.memoryMB, `${p.name}: memory`).toBeLessThan(budget.memoryMB);
    }
  }

  // The end reads exactly right, and nothing in the file changed.
  expect(atEnd, 'the end of the document is drawn').toContain(END_OF_DOCUMENT);
  expect(await j.text(), 'the document is as it was opened').toBe(doc);
}

test.describe('long documents @long', () => {
  // One document at a time (the workflow runs this tier with one worker).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(240_000);

  test('the shape of the 4.7 MB document: 12,700 lines, 18 of them very long', async ({
    start,
  }) => {
    await journey(
      'long-lines',
      longLinesDocument(),
      { stall: 250, frame: 300, memoryMB: 2500, open: 15_000 },
      start,
    );
  });

  test('1 MB of ordinary text with hundreds of changes and comments', async ({ start }) => {
    await journey(
      'one-mb',
      ordinaryDocument(1_000_000),
      { stall: 600, frame: 600, memoryMB: 2500, open: 15_000 },
      start,
    );
  });

  test('5 MB of ordinary text with hundreds of changes and comments', async ({ start }) => {
    await journey(
      'five-mb',
      ordinaryDocument(5_000_000),
      { stall: 800, frame: 800, memoryMB: 3500, open: 40_000 },
      start,
    );
  });
});
