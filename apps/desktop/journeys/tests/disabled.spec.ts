// Disabled, with the reason (R6, #497): a command that has no sound target is grayed, and its hint
// says what the thing is and what to do. A key says it as a notice that doesn't interrupt; a grayed
// button keeps the pointer, so its hint shows (the card is laid out off screen in the dev page's
// window, so this journey reads it and takes no picture of it).

import { expect, test } from '../src/journey.ts';

const LOST = `A <!--fmt m2bd +bold-->big<!--/m2bd--> plan, and more words.

<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
  m2bd: {by: bo, at: 2026-10-31T09:30Z}
-->
`;

test.describe('disabled commands say why @views', () => {
  test('Indent in a paragraph is grayed, and its key says why as a notice', async ({ start }) => {
    const j = await start({
      doc: 'A paragraph, not a list item.\n',
      tracking: false,
      view: 'clean',
    });
    await j.caretAfter('paragraph');
    const ui = await j.uiState();
    expect((ui['disabledReasons'] as Record<string, string>)['block.indent']).toBe(
      'Only a list item can be indented or outdented.',
    );
    expect(ui['enabledCommands']).not.toContain('block.indent');
    await j.press('Meta+]');
    await j.settle();
    await expect(j.page.locator('.rl-notice')).toHaveText(
      'Only a list item can be indented or outdented.',
    );
    await j.shot('indent-in-paragraph');
  });

  test('Reject on a change that can only be accepted is grayed, with the reason', async ({
    start,
  }) => {
    const j = await start({ doc: LOST, tracking: false, view: 'redlines' });
    await j.click('big');
    const reject = j.page.locator('.rl-card').getByRole('button', { name: 'Reject' });
    await expect(reject).toHaveAttribute('aria-disabled', 'true');
    await expect(reject).toHaveAttribute(
      'title',
      'This change can only be accepted: its text no longer has that formatting.',
    );
    await reject.evaluate((el) => (el as HTMLElement).click());
    expect(await j.text()).toContain('<!--fmt m2bd');
  });
});
