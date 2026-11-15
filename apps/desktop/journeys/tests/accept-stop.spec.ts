// Review ▸ Accept All Changes and Stop Tracking: the whole document, or the selection.
// The page has no menu bar, so a journey chooses the row through the page's hook, which answers as
// the menu would (enabled or not, and the same action).

import { expect, test, type Journey } from '../src/journey.ts';

const ROW = 'Accept All Changes and Stop Tracking';
const DOC = 'Alpha beta\n\nGamma delta\n\nEpsilon zeta\n';

/** Three paragraphs, a tracked insertion in the first and the last, and Track Changes on. */
async function withChanges(
  start: (o: object) => Promise<Journey>,
  scheme?: 'light' | 'dark',
): Promise<Journey> {
  const j = await start({
    doc: DOC,
    tracking: true,
    view: 'redlines',
    ...(scheme ? { scheme } : {}),
  });
  await j.caretAfter('Alpha');
  await j.type(' one');
  await j.caretAfter('Epsilon');
  await j.type(' two');
  return j;
}

const tracking = async (j: Journey) => (await j.uiState())['tracking'];
const pending = async (j: Journey) => ((await j.uiState())['changes'] as unknown[]).length;

test.describe('accept all and stop tracking @views', () => {
  test('with a caret, it accepts every change, turns Track Changes off, and one Undo brings them back', async ({
    start,
  }) => {
    const j = await withChanges(start);
    expect(await pending(j), 'two changes are pending').toBe(2);
    await j.caretAfter('Gamma');
    expect(await j.menuEnabled(ROW)).toBe(true);
    await j.shot('before-whole-document');

    expect(await j.menu(ROW)).toBe(true);
    expect(await pending(j), 'nothing is pending').toBe(0);
    expect(await tracking(j), 'Track Changes is off').toBe(false);
    expect(await j.text()).toBe('Alpha one beta\n\nGamma delta\n\nEpsilon two zeta\n');
    expect(await j.menuEnabled(ROW), 'nothing left to accept').toBe(false);
    await j.shot('after-whole-document');

    // Typing now is plain text: Track Changes is off.
    await j.caretAfter('Gamma');
    await j.type('!');
    expect(await pending(j), 'typing is not tracked').toBe(0);
    await j.press('ControlOrMeta+z');

    // One Undo gives the changes and Track Changes back.
    await j.press('ControlOrMeta+z');
    expect(await pending(j), 'the changes are back').toBe(2);
    expect(await tracking(j), 'Track Changes is on again').toBe(true);
    await j.shot('after-undo');
  });

  test('with a selection, it accepts only the changes in it, and turns Track Changes off', async ({
    start,
  }) => {
    const j = await withChanges(start);
    // The first paragraph, markers and all: from the start of the file to the next paragraph.
    await j.place(0, (await j.text()).indexOf('\n\nGamma'));
    expect(await j.menuEnabled(ROW)).toBe(true);
    await j.shot('selection-before');

    expect(await j.menu(ROW)).toBe(true);
    expect(await pending(j), 'the last change is still pending').toBe(1);
    expect(await tracking(j), 'Track Changes is off').toBe(false);
    expect(await j.text()).toContain('Alpha one beta\n');
    expect(await j.text()).toContain('Epsilon');
    await j.shot('selection-after');

    await j.press('ControlOrMeta+z');
    expect(await pending(j)).toBe(2);
    expect(await tracking(j)).toBe(true);
  });

  test('it is disabled when the selection holds no change, and when the document has none', async ({
    start,
  }) => {
    const j = await withChanges(start, 'dark');
    await j.selectText('Gamma delta');
    expect(await j.menuEnabled(ROW), 'no change in the selection').toBe(false);
    expect(await j.menu(ROW), 'choosing it does nothing').toBe(false);
    expect(await tracking(j), 'Track Changes stays on').toBe(true);
    expect(await pending(j)).toBe(2);
    await j.shot('selection-without-changes');

    const clean = await start({ doc: 'Plain.\n', tracking: true });
    await clean.caretAtEnd();
    expect(await clean.menuEnabled(ROW), 'no change in the document').toBe(false);
  });

  test('comments stay', async ({ start }) => {
    const j = await withChanges(start);
    await j.selectText('Gamma');
    await j.press('ControlOrMeta+Alt+m');
    await j.type('Check this');
    await j.press('ControlOrMeta+Enter');
    expect((await j.text()).includes('<!--cmt'), 'the comment is in the file').toBe(true);
    await j.caretAfter('Gamma');
    expect(await j.menu(ROW)).toBe(true);
    expect((await j.text()).includes('<!--cmt'), 'the comment is still in the file').toBe(true);
  });
});
