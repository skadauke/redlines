// #1207: every test document, opened in every look (Redlines, Clean, Simple; light and dark), draws
// no raw markup: no marker, no `{#…}`, no literal `\n`, no `**`, `$…$`, `~…~` or `:::` that should
// have become a mark, a chip, a box or a formula. The line under the caret is the source and is not
// read. The same scan runs over the Word export and the Quick Look page
// (apps/desktop/src/raw-markup.node.test.ts). See src/raw-markup.ts for the rules and the known cases.

import {
  codeOf,
  judge,
  scanLines,
  WEBKIT_SURFACES,
  type Found,
  type Surface,
} from '../src/raw-markup.ts';
import { testDocuments } from '../src/raw-markup-documents.ts';
import { expect, test, type Journey, type Scheme, type ViewName } from '../src/journey.ts';

const VIEWS: [ViewName, Surface][] = [
  ['redlines', 'redlines'],
  ['clean', 'clean'],
  ['simple', 'simple'],
];

/**
 * The text of every line the page draws, top to bottom, except the line under the caret, which
 * shows its source. The editor draws only what is near the window, so the page is scrolled through.
 */
async function drawnLines(j: Journey): Promise<string[]> {
  return j.page.evaluate(async () => {
    const scroller = document.querySelector('.rl-scroller') as HTMLElement;
    const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
    const seen = new Set<string>();
    const lines: string[] = [];
    scroller.scrollTop = 0;
    for (let guard = 0; guard < 400; guard++) {
      window.__redlines!.editor.view.requestMeasure();
      await frame();
      await frame();
      const active = [...document.querySelectorAll<HTMLElement>('.cm-activeLine')];
      const shown = active.map((line) => line.style.display);
      for (const line of active) line.style.display = 'none';
      const text = scroller.innerText;
      active.forEach((line, i) => (line.style.display = shown[i]!));
      for (const line of text.split('\n')) {
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
        }
      }
      const before = scroller.scrollTop;
      scroller.scrollTop = before + Math.max(120, scroller.clientHeight - 80);
      if (scroller.scrollTop === before) break;
    }
    return lines;
  });
}

const docs = testDocuments();

test.describe('raw markup in what is drawn (#1207) @views', () => {
  test('the documents are there', () => {
    expect(docs.map((doc) => doc.name)).toEqual(
      expect.arrayContaining(['Build 21.md', 'Build 21.qmd', '_method.qmd', 'Bold.md']),
    );
  });

  for (const scheme of ['light', 'dark'] as Scheme[]) {
    test(`no document draws raw markup, in the ${scheme} theme`, async ({ start }) => {
      test.setTimeout(10 * 60_000);
      const found: Found[] = [];
      for (const doc of docs) {
        const j = await start({ doc: doc.text, file: doc.name, scheme });
        const code = codeOf(doc.text);
        for (const [view, surface] of VIEWS) {
          await j.page.evaluate((v) => window.__redlines!.editor.setViewMode(v), view);
          await j.settle();
          for (const hit of scanLines(await drawnLines(j), code)) {
            found.push({ doc: doc.name, surface, hit });
          }
        }
        if (scheme === 'dark') await j.shot(`raw-${doc.name.replace(/\W+/g, '-')}`);
      }
      const { unknown, gone } = judge(
        found,
        WEBKIT_SURFACES,
        docs.map((doc) => doc.name),
      );
      expect(unknown, 'raw markup that no open issue knows').toEqual([]);
      // A known case is judged in the light theme, which draws the same text; in the dark one it
      // would only say the same twice.
      if (scheme === 'light') expect(gone, 'known cases that were fixed').toEqual([]);
    });
  }
});
