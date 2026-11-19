// An edit that is widened to the unit that holds it says so, once, in a passing notice (#1188).

import { expect, test } from '../src/journey.ts';

const DOC = `| a | b | c |
| - | - | - |
| 11 | 12 | 13 |
| <!--ins m2bd row--> 21 | 22 | 23 |
| 31 | 32 | 33 |

<!-- redlines
version: 1
people:
  bo: {name: Bo Chen}
marks:
  m2bd: {by: bo, at: 2026-11-01T10:00Z}
-->
`;

test.describe('the notice of a widened edit @views', () => {
  test('bold over cells that cross Bo’s inserted row says the table was replaced', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: true });
    await j.settle();
    const text = await j.cmText();
    await j.place(text.indexOf('12'), text.indexOf('33') + 2);
    await j.press('Meta+b');
    const notice = j.page.locator('.rl-notice');
    await expect(notice).toHaveText(
      'Tracked as a replacement of the whole table, so that the file and the document read alike.',
    );
    await j.shot('widen-notice');
    expect(await j.cmText()).toContain('<!--sub ');
  });
});
