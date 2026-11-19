// A change's card on the first line of a document (#1235): the card opens below the line, where it
// can be seen, from a click on the change and from hovering over it. CodeMirror put it away (its
// style stayed `top: -10000px`) because the first line is above the top of the editor's box plus the
// room the title bar keeps.

import { expect, test } from '../src/journey.ts';

const DOC = [
  'The new importer<!--ins k3x9--> now<!--/k3x9--> ships.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace}',
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
  '-->',
  '',
].join('\n');

test.describe('a change card on the first line @review', () => {
  for (const how of ['click', 'hover'] as const) {
    test(`opens below the line on a ${how}`, async ({ start }) => {
      const j = await start({ doc: DOC, tracking: false, view: 'redlines' });
      const change = j.page.locator('.rl-ins').first();
      await expect(change).toBeVisible();
      const box = (await change.boundingBox())!;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (how === 'click') await j.page.mouse.click(at.x, at.y);
      else {
        await j.page.mouse.move(at.x - 5, at.y);
        await j.page.mouse.move(at.x, at.y, { steps: 3 });
      }
      const card = j.page.locator('.cm-tooltip .rl-card');
      await expect(card).toBeVisible({ timeout: 3000 });
      const placed = (await card.boundingBox())!;
      // Below the changed text, on the page, and not over the text.
      expect(placed.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
      expect(placed.y).toBeLessThan(box.y + box.height + 40);
      await j.shot(`first-line-card-${how}`);
    });
  }
});
