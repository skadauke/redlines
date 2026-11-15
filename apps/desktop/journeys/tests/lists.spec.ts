// Lists, and the keys at speed that were the first thing to go wrong in them. Each journey is a
// short note of Stephan's from testing build 18; the ones that fail today say which issue is open.

import { expect, test } from '../src/journey.ts';

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

  // #510: a pasted bullet is an item of the list (the rules are in docs/design.md, 5.10).
  test('pasting a bullet into a list adds an item', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.paste('- pasted');
    await j.shot('paste-bullet');
    expect((await j.cmText()).trimEnd().split('\n')).toEqual(['- one', '- two', '- pasted']);
    expect((await j.caret()).lineText).toBe('- pasted');
    // One Undo takes the whole paste back.
    await j.press('ControlOrMeta+z');
    expect(await j.cmText()).toBe('- one\n- two\n');
  });

  test('pasting a numbered item into a bullet list makes a bullet', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.paste('1. pasted');
    await j.shot('paste-numbered-into-bullets');
    expect((await j.cmText()).trimEnd().split('\n')).toEqual(['- one', '- two', '- pasted']);
  });

  test('pasting a bullet into a numbered list is the next number', async ({ start }) => {
    const j = await start({ doc: '1. one\n2. two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.paste('- pasted');
    expect((await j.cmText()).trimEnd().split('\n')).toEqual(['1. one', '2. two', '3. pasted']);
  });

  test('pasting two items, one nested, keeps the depth', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
    await j.caretAfter('two');
    await j.paste('- a\n  - b');
    await j.shot('paste-two-nested');
    expect((await j.cmText()).trimEnd().split('\n')).toEqual(['- one', '- two', '- a', '  - b']);
  });

  test('pasting a bullet in the middle of an item splits it', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: false, view: 'clean' });
    await j.caretAfter('tw');
    await j.paste('- pasted');
    await j.shot('paste-middle');
    expect((await j.cmText()).trimEnd().split('\n')).toEqual(['- one', '- tw', '- pasted', '- o']);
    await j.press('ControlOrMeta+z');
    expect(await j.cmText()).toBe('- one\n- two\n');
  });

  test('pasting a bullet with Track Changes on is a tracked insertion', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: true, view: 'redlines' });
    await j.caretAfter('two');
    await j.paste('- pasted');
    await j.shot('paste-bullet-tracked');
    const file = await j.cmText();
    expect(file).toContain('<!--ins ');
    expect(file.split('<!-- redlines')[0]).toMatch(/- two<!--ins \w+--><!--split \w+-->\n- pasted/);
    await j.press('ControlOrMeta+z');
    expect((await j.cmText()).split('<!-- redlines')[0]).toBe('- one\n- two\n');
  });

  test('pasting a bullet into the middle of an item with Track Changes on', async ({ start }) => {
    const j = await start({ doc: '- one\n- two\n', tracking: true, view: 'redlines' });
    await j.caretAfter('tw');
    await j.paste('- a\n  - b');
    await j.shot('paste-middle-tracked');
    expect(await j.cmText()).toContain('<!--ins ');
  });

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

  // Other shapes of the same flow, which Stephan may have had: a checked item above, a document
  // that goes on after the checklist, and the Clean view. Each ends the checklist as a bullet does.
  const SHAPES: [string, string, string, 'clean' | 'redlines'][] = [
    ['a checked item above', '- [x] done\n', 'done', 'redlines'],
    ['text after the checklist', '- [ ] one\n\nAfter\n', 'one', 'redlines'],
    ['no newline at the end of the file', '- [ ] one', 'one', 'clean'],
    ['a numbered checklist', '1. [ ] one\n2. [x] two\n', 'two', 'clean'],
  ];
  for (const tracking of [false, true]) {
    for (const [name, doc, after, view] of SHAPES) {
      test(`Return on an empty last checkbox ends the checklist: ${name}, Track Changes ${tracking ? 'on' : 'off'}`, async ({
        start,
      }) => {
        const j = await start({ doc, tracking, view });
        await j.caretAfter(after);
        await j.press('Enter');
        expect((await j.caret()).lineText, 'a new empty checkbox').toMatch(/^(- |\d+\. )\[ \] $/);
        await j.press('Enter');
        const lines = (await j.cmText()).split('<!-- redlines')[0]!.split('\n');
        expect(
          lines.filter((line) => /^(- |\d+\. )\[[ x]\]\s*$/.test(line)),
          'no empty checkbox is left',
        ).toEqual([]);
        expect((await j.caret()).lineText, 'the caret is outside the list').toBe('');
        await j.shot(
          `checklist-ended-${name.replace(/\W+/g, '-')}-${tracking ? 'tracked' : 'plain'}`,
        );
      });
    }
  }

  // #604: Backspace at the first item takes its marker away; the list under it stays a list, moved
  // out a level (with Track Changes off), and with it on the key says so and writes nothing.
  for (const tracking of [false, true]) {
    test(`Backspace at the first item with a list nested in it, Track Changes ${tracking ? 'on' : 'off'}`, async ({
      start,
    }) => {
      const doc = '* note\n    - one\n        - two\n    - three\n';
      const j = await start({ doc, tracking, view: 'redlines' });
      await j.place(2);
      const look = tracking ? 'tracked' : 'plain';
      await j.shot(`backspace-nested-before-${look}`);
      await j.press('Backspace');
      await j.shot(`backspace-nested-after-${look}`);
      const file = (await j.cmText()).split('<!-- redlines')[0]!;
      if (tracking) {
        // Refused in words, and nothing is written: the nested list is not turned into text.
        expect(file).toBe(doc);
      } else {
        // The text is a paragraph, the list under it is still a list, the depth among its items kept.
        expect(file).toBe('note\n  - one\n      - two\n  - three\n');
        await j.press('ControlOrMeta+z');
        expect(await j.cmText()).toBe(doc);
        await j.shot('backspace-nested-undone-plain');
      }
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

  test("showing a marker's source does not move the item's text", async ({ start }) => {
    const j = await start({ doc: '- aaa\n  - bbb\n1. ccc\n', tracking: false, view: 'clean' });
    for (const word of ['aaa', 'bbb', 'ccc']) {
      await j.caretAtEnd();
      const before = (await j.pointOf(word)).x;
      await j.place((await j.cmText()).indexOf(word) - 1);
      await j.shot(`source-shown-${word}`);
      expect(Math.abs((await j.pointOf(word)).x - before), `${word} stays`).toBeLessThan(0.6);
    }
  });
});
