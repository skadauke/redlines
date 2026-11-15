// The corner word count follows typing and selecting without a visible delay (#534).

import { expect, test } from '../src/journey.ts';

test.describe('the word count @views', () => {
  test('the count follows typing and selecting within a fraction of a second', async ({
    start,
  }) => {
    const j = await start({
      doc: 'One two three\n',
      tracking: false,
      view: 'clean',
      wordCount: true,
    });
    const label = j.page.locator('.rl-word-count');
    await j.caretAfter('three');
    await j.type(' four five');
    // Well under the old 400 ms idle wait, after the last key.
    await expect(label).toHaveText('5 words', { timeout: 300 });
    await j.press('Shift+Home');
    await expect(label).toHaveText('5 of 5 words', { timeout: 150 });
    await j.shot('word-count-selection');
  });
});
