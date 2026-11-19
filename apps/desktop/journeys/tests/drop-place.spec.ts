// The place a dragged block will land (#1200): a little room opens there, animated (and at once with
// reduced motion), and the marker in it is a faint blue, not gray. The table drags the same way.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  'First paragraph of the file.',
  '',
  'Second paragraph, the one that moves.',
  '',
  'Third paragraph, in the middle.',
  '',
  'Last paragraph.',
  '',
].join('\n');

const room = (j: Journey) =>
  j.page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.rl-drop-space');
    const line = document.querySelector<HTMLElement>('.rl-drop-space .rl-drop-line');
    return el && line
      ? {
          height: el.getBoundingClientRect().height,
          animation: getComputedStyle(el).animationDuration,
          color: getComputedStyle(line).backgroundColor,
        }
      : null;
  });

/** Records, as the room is first drawn, whether it runs an animation. */
const watchRoom = (j: Journey) =>
  j.page.evaluate(() => {
    const seen: { animations: number; name: string }[] = [];
    (window as unknown as { __rooms: typeof seen }).__rooms = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('rl-drop-space')) {
            seen.push({
              animations: node.getAnimations().length,
              name: getComputedStyle(node).animationName,
            });
          }
        }
      }
    }).observe(document.querySelector('.cm-content')!, { childList: true, subtree: true });
  });
const rooms = (j: Journey) =>
  j.page.evaluate(
    () => (window as unknown as { __rooms: { animations: number; name: string }[] }).__rooms,
  );

/** Presses on the selected paragraph and drags it to just above `Last paragraph.`, holding the button. */
async function dragToLast(j: Journey) {
  await j.selectText('Second paragraph, the one that moves.');
  const from = await j.pointOf('the one that');
  const to = await j.pointOf('Last paragraph.');
  await j.page.mouse.move(from.x, from.y);
  await j.page.mouse.down();
  await j.page.mouse.move(from.x + 10, from.y + 30, { steps: 6 });
  await j.page.mouse.move(to.x, to.y - 10, { steps: 10 });
}

test.describe('the drop place @blocks', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`room opens at the place, with a faint blue line in it (${scheme})`, async ({ start }) => {
      const j = await start({ doc: DOC, tracking: false, view: 'redlines', scheme });
      // The page is told before it draws: the harness starts every page with reduced motion.
      await j.page.emulateMedia({ reducedMotion: 'no-preference' });
      await j.page.reload();
      await j.page.waitForFunction(() => window.__redlines !== undefined);
      await j.page.evaluate((doc) => window.__redlines!.editor.setDoc(doc), DOC);
      await j.settle();
      const before = (await j.pointOf('Last paragraph.')).y;
      await watchRoom(j);
      await dragToLast(j);
      await expect
        .poll(async () => (await room(j))?.height ?? 0, 'the room opens')
        .toBeGreaterThan(20);
      const open = (await room(j))!;
      const [first] = await rooms(j);
      expect(first?.name, 'it opens with an animation').toBe('rl-drop-open');
      expect(first?.animations).toBeGreaterThan(0);
      // A faint blue: more blue than red, translucent, not gray.
      const [r, , b, a] = (open.color.match(/[\d.]+/g) ?? []).map(Number) as [
        number,
        number,
        number,
        number | undefined,
      ];
      expect(b, 'the line is blue').toBeGreaterThan(r + 60);
      expect(a ?? 1, 'and faint').toBeLessThan(0.8);
      // The last paragraph went down by the room that opened above it.
      expect((await j.pointOf('Last paragraph.')).y).toBeGreaterThan(before + 10);
      await j.shot(`drop-place-${scheme}`);
      await j.page.mouse.up();
      await expect(j.page.locator('.rl-drop-space')).toHaveCount(0);
      const text = await j.text();
      expect(text.indexOf('Second paragraph')).toBeGreaterThan(text.indexOf('Third paragraph'));
      expect(text.indexOf('Second paragraph')).toBeLessThan(text.indexOf('Last paragraph'));
    });
  }

  test('with reduced motion the room is there at once, with no animation', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'redlines' });
    await j.page.emulateMedia({ reducedMotion: 'reduce' });
    await watchRoom(j);
    await dragToLast(j);
    await expect(j.page.locator('.rl-drop-space')).toHaveCount(1);
    const open = (await room(j))!;
    const [first] = await rooms(j);
    expect(first?.animations, 'no animation runs').toBe(0);
    expect(first?.name).not.toBe('rl-drop-open');
    expect(open.height, 'the whole room, with no growing').toBeGreaterThan(20);
    await j.shot('drop-place-reduced-motion');
    await j.page.mouse.up();
  });
});
