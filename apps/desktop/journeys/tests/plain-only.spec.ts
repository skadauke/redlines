// A text or code file (#663): it opens in Plain alone, colored for its language, with the view rows
// and Track Changes disabled and saying why, and a Markdown file beside it as it was.

import { expect, test, type Journey } from '../src/journey.ts';

const TS = `// A small module.
export function greet(name: string): string {
  const word = "Hello";
  return \`\${word}, \${name}! <!--ins k3x9-->\`;
}

const count: number = 42;
`;

async function openEye(j: Journey) {
  await j.page.getByRole('button', { name: 'View', exact: true }).hover();
  const items = j.page.locator('.rl-menu-item').filter({ visible: true });
  await expect(items.first()).toBeVisible();
  return (label: string) => items.filter({ hasText: new RegExp(`^${label}`) });
}

test.describe('text and code files @views', () => {
  test('a .ts file opens in Plain, in the code colors, and the eye says why Clean and Redlines are off', async ({
    start,
  }) => {
    const j = await start({ doc: TS, file: 'app.ts' });
    await expect(j.page.locator('.cm-content')).toContainText('greet');
    const ui = await j.uiState();
    expect(ui).toMatchObject({ kind: 'plain-only', view: 'raw', tracking: false });
    // The grammar loads on demand: the keyword is colored once it has arrived.
    await expect
      .poll(() =>
        j.page.evaluate(
          () =>
            [...document.querySelectorAll('.cm-content span[class]')].filter((el) =>
              ['export', 'const', 'string'].includes(el.textContent ?? ''),
            ).length,
        ),
      )
      .toBeGreaterThan(0);
    // The text is the file as it is: a marker in a string is text.
    expect(await j.text()).toBe(TS);
    await j.shot('ts-file-plain');

    const row = await openEye(j);
    await expect(row('Clean')).toBeDisabled();
    await expect(row('Redlines')).toBeDisabled();
    await expect(row('Clean')).toHaveAttribute(
      'title',
      'Only Markdown files have Clean and Redlines views.',
    );
    await expect(row('Plain')).toBeEnabled();
    await j.shot('ts-file-eye-menu');
  });

  test('Track Changes is off and cannot be turned on, and typing is plain editing', async ({
    start,
  }) => {
    const j = await start({ doc: TS, file: 'app.ts' });
    await j.page.getByRole('button', { name: 'Track Changes', exact: true }).hover();
    const tracking = j.page.locator('.rl-menu-item').filter({ hasText: /^Track Changes/ });
    await expect(tracking.first()).toBeDisabled();
    await j.press('Meta+Shift+E');
    await j.settle();
    expect((await j.uiState())['tracking']).toBe(false);
    await j.caretAtEnd();
    await j.type('// end');
    expect(await j.text()).toBe(`${TS}// end`);
  });

  test('a .txt file is Plain, and a .md file beside it is still Markdown', async ({ start }) => {
    const j = await start({ doc: '* not a list_item_ here\n', file: 'notes.txt' });
    expect(await j.uiState()).toMatchObject({ kind: 'plain-only', view: 'raw' });
    expect(await j.drawn()).toContain('* not a list_item_ here');
    await j.page.evaluate(() => window.__redlines!.openFile('plan.md', 'A *plan*.\n'));
    await j.settle();
    expect(await j.uiState()).toMatchObject({ kind: 'markdown', view: 'clean' });
  });
});
