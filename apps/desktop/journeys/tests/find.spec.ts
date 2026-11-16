// Find and Replace as a panel (#554): Find in a selection, Replace All with Track Changes on (one
// tracked change per match, one Undo), and Tab from Find to Replace.

import { expect, test, type Journey } from '../src/journey.ts';

const DOC = [
  'The cat sat on the mat.',
  '',
  'A second cat slept by the door, and a third cat watched.',
  '',
  'Last of all, the cat left.',
  '',
].join('\n');

const panel = (j: Journey) => j.page.locator('.rl-find-bar');
const count = (j: Journey) => j.page.locator('.rl-find-count').textContent();

/** Types into the find box as a person does, with the panel open. */
async function find(j: Journey, text: string) {
  await j.press('ControlOrMeta+f');
  await expect(panel(j)).toBeVisible();
  await j.type(text);
}

test.describe('Find and Replace panel', () => {
  test('a selection of more than one block limits Find to it', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    const from = (await j.offsetAfter('The ')) - 'The '.length;
    await j.place(from, await j.offsetAfter('third cat'));
    await j.press('ControlOrMeta+f');
    await expect(panel(j)).toBeVisible();
    await expect(j.page.getByRole('button', { name: 'Find in Selection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(j.page.locator('.rl-find-query')).toHaveAttribute(
      'placeholder',
      'Find in selection',
    );
    await j.type('cat');
    // The fourth "cat" lies outside the selection.
    expect(await count(j)).toBe('1 of 3');
    await expect(j.page.locator('.rl-find-scope').first()).toBeVisible();
    await j.shot('in-selection');
    await j.press('Tab');
    await j.type('dog');
    await j.page.getByRole('button', { name: 'Replace All' }).click();
    await j.settle();
    expect(await j.text()).toBe(
      DOC.replace('cat sat', 'dog sat')
        .replace('cat slept', 'dog slept')
        .replace('cat watched', 'dog watched'),
    );
    await j.shot('in-selection-replaced');
  });

  test('Replace All with Track Changes on is one change per match, and one Undo', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
    await j.caretAtStart();
    await find(j, 'cat');
    expect(await count(j)).toBe('1 of 4');
    await j.press('Tab');
    await expect(j.page.locator('.rl-find-pen')).toBeVisible();
    await j.type('dog');
    await j.shot('replace-typed');
    await j.page.getByRole('button', { name: 'Replace All' }).click();
    await j.settle();
    const text = await j.text();
    expect(text.match(/<!--sub /g)).toHaveLength(4);
    await expect(j.page.locator('.rl-notification')).toContainText('Replaced 4 matches');
    await j.shot('replace-all-tracked');
    await j.page.locator('.rl-notification').getByRole('button', { name: 'Undo' }).click();
    await j.settle();
    expect(await j.text()).toBe(DOC);
  });

  test('Tab goes from Find to Replace and Shift-Tab back', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'clean' });
    await find(j, 'cat');
    await expect(j.page.locator('.rl-find-replacement')).toHaveCount(0);
    await j.press('Tab');
    await expect(j.page.locator('.rl-find-replacement')).toBeFocused();
    await j.shot('tab-to-replace');
    await j.page.locator('.rl-find-toggle-matchCase').hover();
    await j.shot('hint');
    await j.press('Shift+Tab');
    await expect(j.page.locator('.rl-find-query')).toBeFocused();
    await j.press('ControlOrMeta+Alt+r');
    await j.type('(');
    expect(await count(j)).toBe('Invalid');
    await j.shot('invalid');
    await j.press('Escape');
    await expect(panel(j)).toHaveCount(0);
  });
});
