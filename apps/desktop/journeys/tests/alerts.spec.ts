// Alerts one blank line apart are two boxes with a gap between them (#389), not one tint.

import { expect, test } from '../src/journey.ts';

const DOC = [
  '> [!NOTE]',
  '> The first alert.',
  '',
  '> [!TIP]',
  '> The second, with',
  '> two lines.',
  '',
  '> [!WARNING]',
  '> The third.',
  '',
  'A paragraph after them.',
  '',
].join('\n');

test.describe('alerts @blocks', () => {
  test('two alerts one blank line apart have a gap, and the tint stops at the box', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await j.caretAtEnd();
    const boxes = await j.page.evaluate(() => {
      const lines = [...document.querySelectorAll<HTMLElement>('.cm-line.rl-callout')];
      return lines.map((line) => {
        const rect = line.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          clip: getComputedStyle(line).clipPath,
          first: line.classList.contains('rl-callout-first'),
          last: line.classList.contains('rl-callout-last'),
        };
      });
    });
    expect(boxes.length, 'the lines of three alerts').toBe(7);
    const firsts = boxes.filter((line) => line.first);
    const lasts = boxes.filter((line) => line.last);
    expect(firsts.length).toBe(3);
    // The first alert starts the document. The others start after a gap: the tint is clipped to
    // leave out the top of their first line, which is the space, as padding.
    expect(firsts[0]!.clip).toBe('none');
    const gap = (box: (typeof boxes)[number]) =>
      Number(/^inset\(([\d.]+)px/.exec(box.clip)?.[1] ?? NaN);
    for (const [at, second] of firsts.slice(1).entries()) {
      expect(gap(second), `the gap above alert ${at + 2}`).toBeGreaterThanOrEqual(8);
      // It sits where the box above ends: its line starts at the bottom of that box's last.
      expect(Math.abs(second.top - lasts[at]!.bottom), 'no margin between the lines').toBeLessThan(
        1,
      );
    }
    await j.shot('alerts-apart');
  });
});
