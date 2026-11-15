// Lists, and the keys at speed that were the first thing to go wrong in them. Each journey is a
// short note of Stephan's from testing build 18; the ones that fail today say which issue is open.

import { expect, known, test } from '../src/journey.ts';

test.describe('lists @lists', () => {
  test('Tab, then typing in a burst, in a bullet list @smoke', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.after('Tab', 'abc');
    expect(await j.text()).toBe('- one\n  - twoabc\n');
    expect(await j.selectedText()).toBe('');
    expect((await j.caret()).lineText).toBe('  - twoabc');
    expect((await j.caret()).column).toBe('  - twoabc'.length);
    await j.shot('tab-burst-bullet');
  });

  test('Tab, then typing in a burst, in a numbered list', async ({ start }) => {
    const j = await start({ doc: '1. one\n2. two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.after('Tab', 'abc');
    expect(await j.text()).toBe('1. one\n   1. twoabc\n');
    expect((await j.caret()).column).toBe('   1. twoabc'.length);
    await j.shot('tab-burst-numbered');
  });

  test('Shift-Tab, Tab and Return, each followed by a burst, keep the letters in order', async ({
    start,
  }) => {
    const j = await start({ doc: '- one\n  - two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.after('Shift+Tab', 'abc');
    expect(await j.text()).toBe('- one\n- twoabc\n');
    await j.after('Tab', 'def');
    expect(await j.text()).toBe('- one\n  - twoabcdef\n');
    await j.after('Enter', 'ghi');
    expect(await j.cmText()).toBe('- one\n  - twoabcdef\n  - ghi\n');
  });

  known(
    510,
    'pasting a bullet into a list adds an item',
    /the pasted bullet is an item of its own/,
    async ({ start }) => {
      const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
      await j.caretAfter('two');
      await j.paste('- pasted');
      await j.shot('paste-bullet');
      // Today the paste lands inside the item: "- two- pasted".
      expect(
        (await j.cmText()).trimEnd().split('\n'),
        'the pasted bullet is an item of its own',
      ).toEqual(['- one', '- two', '- pasted']);
    },
  );

  // Stephan saw the checklist stay open (#513); in the page it ends, with Track Changes off and
  // on, so this guards it. If it fails in the app and not here, the app's own path differs.
  for (const tracking of [false, true]) {
    test(`Return on an empty last checkbox ends the checklist, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const j = await start({ doc: '- [ ] one\n', tracking, view: 'redlines' });
      await j.caretAfter('one');
      await j.press('Enter');
      await j.shot(`checkbox-new-item-${tracking ? 'tracked' : 'plain'}`);
      expect((await j.caret()).lineText).toBe('- [ ] ');
      await j.press('Enter');
      await j.shot(`checkbox-ended-${tracking ? 'tracked' : 'plain'}`);
      // The empty item is gone and the caret is on a line of its own, outside the list.
      expect((await j.caret()).lineText).toBe('');
      expect((await j.cmText()).split('\n').filter((line) => /^- \[ \]\s*$/.test(line))).toEqual(
        [],
      );
    });
  }

  test('Return on an empty last bullet ends the list (the control for the checkbox)', async ({
    start,
  }) => {
    const j = await start({ doc: '- one\n- \n', tracking: false, view: 'clean' });
    await j.place((await j.cmText()).indexOf('- \n') + 2);
    await j.press('Enter');
    expect((await j.cmText()).split('\n').filter((line) => /^- *$/.test(line))).toEqual([]);
  });

  // #511: a bullet and a number at the same level start at the same place, as does their text,
  // at every level, in the four looks (`JOURNEYS_PROJECTS=all`).
  test('bullets and numbers indent to exactly the same place', async ({ start }) => {
    const bullets = '- aaa\n  - bbb\n    - ccc\n      - ddd\n';
    const numbers = '1. aaa\n   1. bbb\n      1. ccc\n         1. ddd\n';
    const mixed = '- aaa\n  1. bbb\n     - ccc\n       1. ddd\n';
    const places = async (doc: string) => {
      const j = await start({ doc, tracking: false, view: 'clean' });
      await j.caretAtEnd();
      const out: { mark: number; text: number }[] = [];
      for (const word of ['aaa', 'bbb', 'ccc', 'ddd']) {
        const text = (await j.pointOf(word)).x;
        const mark = await j.page.evaluate((w) => {
          const lines = [...document.querySelectorAll<HTMLElement>('.cm-line')];
          const line = lines.find((l) => l.textContent?.includes(w))!;
          return line.querySelector('.rl-list-mark')!.getBoundingClientRect().left;
        }, word);
        out.push({ mark, text });
      }
      return { j, out };
    };
    const a = await places(bullets);
    await a.j.shot('indent-bullets');
    const b = await places(numbers);
    await b.j.shot('indent-numbers');
    const c = await places(mixed);
    await c.j.shot('indent-mixed');
    const close = (x: number, y: number) => Math.abs(x - y) <= 0.6;
    for (let level = 0; level < 4; level++) {
      for (const other of [b.out, c.out]) {
        expect(close(a.out[level]!.text, other[level]!.text), `text, level ${level + 1}`).toBe(
          true,
        );
        expect(close(a.out[level]!.mark, other[level]!.mark), `marker, level ${level + 1}`).toBe(
          true,
        );
      }
    }
    // Each level is further right than the one above it.
    for (let level = 1; level < 4; level++) {
      expect(a.out[level]!.text).toBeGreaterThan(a.out[level - 1]!.text + 10);
    }
  });
});
