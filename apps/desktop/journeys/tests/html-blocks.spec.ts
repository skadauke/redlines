// HTML blocks with no Markdown twin, drawn as GitHub draws them (#689): a click selects the block,
// Return or a double-click or the label opens its source, leaving draws it again; a tracked edit in
// the source is an ordinary tracked edit; a long source opens in Plain.

import { expect, test, type Journey } from '../src/journey.ts';

const BLOCK = [
  '<p align="center">',
  '  <b>Redlines</b> shows <i>every</i> change, as <a href="https://example.com">GitHub</a> would.',
  '</p>',
].join('\n');
const TABLE = [
  '<table>',
  '<tr><th colspan="2">Spans</th></tr>',
  '<tr><td>one</td><td>two</td></tr>',
  '<caption>A table with a caption</caption>',
  '</table>',
].join('\n');
const DOC = `# A README\n\n${BLOCK}\n\nA paragraph of Markdown.\n\n${TABLE}\n\nThe end.\n`;

const block = (j: Journey) => j.page.locator('.rl-html-block');

test.describe('HTML blocks @blocks', () => {
  test('draws the block, selects it, opens its source and draws it again', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await expect(block(j)).toHaveCount(2);
    await expect(block(j).first()).toContainText('Redlines shows every change');
    // Nothing of the source shows.
    expect(await j.drawn()).not.toContain('<p align');
    await j.shot('rendered');
    await block(j).first().hover();
    await j.shot('hover');
    await block(j).first().click();
    await expect(j.page.locator('.rl-html-block-selected')).toHaveCount(1);
    await j.shot('selected');
    await j.press('Enter');
    await expect(j.page.locator('.rl-html-source-head')).toBeVisible();
    await expect(block(j)).toHaveCount(1);
    await j.shot('source');
    // Edited in place, untracked.
    await j.caretAfter('shows <i>every</i>');
    await j.type(' single');
    expect(await j.text()).toContain('shows <i>every</i> single change');
    await j.page.getByRole('button', { name: 'Done' }).click();
    await expect(block(j)).toHaveCount(2);
    await expect(block(j).first()).toContainText('every single change');
    await j.shot('drawn-again');
  });

  test('a double-click opens the source, and moving out draws the block again', async ({
    start,
  }) => {
    const j = await start({ doc: DOC, tracking: false, view: 'clean' });
    await block(j).nth(1).dblclick();
    await expect(j.page.locator('.rl-html-source-head')).toBeVisible();
    await expect(j.page.locator('.rl-html-source').first()).toContainText('<table>');
    await j.caretAtEnd();
    await expect(j.page.locator('.rl-html-source-head')).toHaveCount(0);
    await expect(block(j)).toHaveCount(2);
  });

  test('a tracked edit in the source is an ordinary tracked edit', async ({ start }) => {
    const j = await start({ doc: DOC, tracking: true, view: 'redlines' });
    await block(j).first().dblclick();
    await j.caretAfter('shows <i>every</i>');
    await j.type(' single');
    const text = await j.text();
    expect(text).toContain('single');
    expect(text).toContain('<!--');
    // The pending change is seen and decided in its text, not drawn away.
    await j.shot('tracked-source');
    await j.caretAtEnd();
    await expect(block(j)).toHaveCount(1);
  });

  test('a source of more than sixty lines opens in Plain, at the spot', async ({ start }) => {
    const long = `<p>\n${'a line\n'.repeat(70)}</p>`;
    const j = await start({ doc: `Intro.\n\n${long}\n\nOutro.\n`, tracking: false, view: 'clean' });
    await block(j).first().dblclick();
    await expect(block(j)).toHaveCount(0);
    expect(await j.drawn()).toContain('<p>');
  });
});
