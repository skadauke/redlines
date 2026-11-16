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

  test('in Redlines, the change bars of two alerts are two bars, not one across the gap', async ({
    start,
  }) => {
    const j = await start({
      doc: '> [!NOTE]\n> The first alert.\n\n> [!TIP] A title\n> The second.\n',
      tracking: true,
      view: 'redlines',
    });
    await j.caretAfter('first alert');
    await j.type(' more');
    await j.caretAfter('A title');
    await j.type(' here');
    await j.caretAtEnd();
    await j.shot('alerts-apart-bars');
    const bars = await j.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.cm-editor .rl-bar-seg')].map((bar) => {
        const rect = bar.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left };
      }),
    );
    expect(bars.length, 'a bar for each alert').toBe(2);
    const [first, second] = bars.sort((a, b) => a.top - b.top) as [
      (typeof bars)[0],
      (typeof bars)[0],
    ];
    // The gap between the boxes is between the bars: the second starts where its box does.
    expect(second.top - first.bottom, 'the bars do not meet across the gap').toBeGreaterThanOrEqual(
      8,
    );
  });

  // Code, a table and front matter under an alert, and an alert under code, keep their space
  // outside both boxes (#639): the alert does not grow, and the tinted boxes do not touch.
  test('code under an alert, and an alert under code, have a gap and do not grow the box', async ({
    start,
  }) => {
    const doc = [
      '> [!NOTE]',
      '> The first alert.',
      '',
      '```',
      'code under an alert',
      '```',
      '',
      '> [!TIP]',
      '> An alert under code.',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```',
      'code under a table',
      '```',
      '',
      '```',
      'code under code',
      '```',
      '',
    ].join('\n');
    const j = await start({ doc, tracking: false, view: 'clean' });
    await j.caretAtEnd();
    const lines = await j.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.cm-line')].map((line) => {
        const rect = line.getBoundingClientRect();
        // What is painted: the line's box less what the clip takes off.
        const clip = /^inset\(([\d.]+)px [\d.]+px ([\d.]+)px/.exec(getComputedStyle(line).clipPath);
        const top = rect.top + (clip ? Number(clip[1]) : 0);
        const bottom = rect.bottom - (clip ? Number(clip[2]) : 0);
        return { text: line.textContent ?? '', top, bottom };
      }),
    );
    const painted = (text: string) => lines.find((line) => line.text.includes(text))!;
    const gap = (above: string, below: string) => painted(below).top - painted(above).bottom;
    expect(
      gap('The first alert.', 'code under an alert'),
      'code under an alert',
    ).toBeGreaterThanOrEqual(8);
    expect(
      gap('code under an alert', 'An alert under code'),
      'alert under code',
    ).toBeGreaterThanOrEqual(8);
    expect(gap('code under a table', 'code under code'), 'code under code').toBeGreaterThanOrEqual(
      8,
    );
    await j.shot('alerts-tinted-gaps');
  });
});
