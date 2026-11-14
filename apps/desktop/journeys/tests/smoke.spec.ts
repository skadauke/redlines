// The smoke journeys: the page opens, draws its document, and looks as approved. They run on every
// pull request, and their screenshots are the baselines (`baselines/smoke.spec.ts/`).

import { expect, test } from '../src/journey.ts';

const DOC = `# Notes

A paragraph with **bold**, *italic*, \`code\` and a [link](https://example.org).

- one
- two
  - nested
1. first
2. second

> A quote.

| Name | Count |
| ---- | ----: |
| Ada  |     3 |
| Bo   |    12 |

\`\`\`ts
const answer = 42;
\`\`\`
`;

test('the sample document opens in Redlines @smoke', async ({ start }) => {
  const j = await start({});
  expect(await j.drawn()).toContain('Welcome to Redlines');
  await j.baseline('sample-redlines');
});

test('a document of every block, in Clean @smoke', async ({ start }) => {
  const j = await start({ doc: DOC, tracking: false, view: 'clean' });
  expect(await j.drawn()).toContain('A paragraph with bold');
  await j.baseline('blocks-clean');
});

test('typing with Track Changes on marks the change @smoke', async ({ start }) => {
  const j = await start({ doc: 'The quick fox.\n', tracking: true, view: 'redlines' });
  await j.caretAfter('quick');
  await j.type(' brown');
  expect(await j.text()).toContain('<!--ins');
  await j.baseline('tracked-typing');
});
