// Debug only: shows that a printed page holds the whole document, without a print dialog to press.
// Start the page with `VITE_PRINT_CHECK=1` in the environment of `vite` (it reads nothing in a
// release build). It loads a document much longer than the window (the sample is not: the editor
// draws all of it, so nothing could be shown), fills the print container as the print path does,
// and reports through the console, which `vite` prints: the numbers on a `PRINT-CHECK` line (the
// blocks and images the page holds against the document's own, that no mark of Redlines is in it,
// and the print rules found in the sheets: matchMedia can't switch to print), then
// `PRINT-CHECK done <passed> passed, <failed> failed`. In the app, a debug build started with
// `REDLINES_EXPORT_PDF=<path>` also writes the paginated PDF there.

import { editorDocumentHtml, type Editor } from '@redlines/editor';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { fillPrintPage, printContainer } from './print.ts';

const SETTLE_MS = 1000;

/** The paragraphs of the long document: far more lines than any window holds. */
const PARAGRAPHS = 800;

const renderedLines = (editor: Editor) => editor.view.dom.querySelectorAll('.cm-line').length;

export async function runPrintCheck(editor: Editor): Promise<void> {
  try {
    await check(editor);
  } catch (error) {
    console.warn(`PRINT-CHECK crashed ${JSON.stringify(String(error))}`);
    console.warn('PRINT-CHECK done 0 passed, 1 failed');
  }
}

async function check(editor: Editor): Promise<void> {
  const long = Array.from(
    { length: PARAGRAPHS },
    (_, i) => `Paragraph ${i + 1} of the long document, which the print check draws and counts.`,
  ).join('\n\n');
  editor.reloadDoc(long);
  editor.view.scrollDOM.scrollTop = 0;
  editor.view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const documentLines = editor.getDoc().split('\n').length;
  const before = renderedLines(editor);
  const release = await fillPrintPage(editorDocumentHtml(editor.view));
  const page = printContainer();
  const images = Array.from(page.querySelectorAll('img'));
  const blocks = page.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, tr, pre').length;
  const marks = page.querySelectorAll('ins, del, mark, [class*="rl-bar"], [class*="rl-mark"]');
  const markers = /<!--/.test(page.innerHTML);
  const rules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
    .filter((rule) => rule.media.mediaText.includes('print'));
  console.warn(
    `PRINT-CHECK ${JSON.stringify({
      documentLines,
      renderedBeforePrint: before,
      pageBlocks: blocks,
      pageText: page.textContent?.length ?? 0,
      images: images.length,
      imagesLoaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      marks: marks.length,
      markers,
      printRules: rules.length,
    })}`,
  );
  let pdf = true;
  if (isTauri()) {
    const path = await invoke<string | null>('export_pdf', { name: 'check.pdf', folder: null });
    console.warn(`PRINT-CHECK pdf ${path ?? 'cancelled'}`);
    pdf = path !== null;
  }
  release();
  // The editor drew only what is near the window; the printed page holds every paragraph, and no
  // mark of Redlines.
  const ok =
    before > 0 &&
    before < PARAGRAPHS / 2 &&
    blocks >= PARAGRAPHS &&
    marks.length === 0 &&
    !markers &&
    rules.length > 0 &&
    pdf;
  const breaks = await checkBreaks(editor);
  const passed = ok && breaks;
  console.warn(`PRINT-CHECK done ${passed ? 1 : 0} passed, ${passed ? 0 : 1} failed`);
}

/** A tiny picture, which a print can hold without a file. */
const PICTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * The page's margin and its breaks (#1184): the rule that gives every page an inch, headings in a
 * box with what follows (a paragraph, a short code block, a picture, a table's first row, and the
 * heading after them), a short code block and a picture that do not split, and a long code block
 * that does. WebKit's pagination can't be run here, so this reads what the page asks of it: the
 * rules in the sheets and the structure that `fillPrintPage` made.
 */
async function checkBreaks(editor: Editor): Promise<boolean> {
  const code = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  const doc = [
    '# Title',
    '',
    '## A heading before a paragraph',
    '',
    'Text.',
    '',
    '## A heading before a short block',
    '',
    '```',
    code(10),
    '```',
    '',
    '## A heading before a picture',
    '',
    `![A pixel](${PICTURE})`,
    '',
    '## A heading before a table',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '## A long block',
    '',
    '```',
    code(80),
    '```',
    '',
  ].join('\n');
  editor.reloadDoc(doc);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const release = await fillPrintPage(editorDocumentHtml(editor.view));
  const page = printContainer();
  const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
  const pageRule = rules.find((rule): rule is CSSPageRule => rule instanceof CSSPageRule);
  const headings = Array.from(page.querySelectorAll('h2'));
  const kept = headings.filter((heading) => heading.parentElement?.classList.contains('rl-keep'));
  const pres = Array.from(page.querySelectorAll('pre'));
  const result = {
    margin: pageRule?.style.margin ?? null,
    headings: headings.length,
    headingsKept: kept.length,
    shortBlocksWhole: pres.filter((pre) => !pre.classList.contains('rl-long')).length,
    longBlocksSplit: pres.filter((pre) => pre.classList.contains('rl-long')).length,
    // A heading is never the last thing in its box: something follows it.
    keptAlone: kept.filter((heading) => !heading.nextElementSibling).length,
  };
  console.warn(`PRINT-CHECK breaks ${JSON.stringify(result)}`);
  release();
  // Of the five headings, the one before the long block is the only one not boxed.
  return (
    /^1in$|^72pt$|^96px$/.test(result.margin ?? '') &&
    result.headings === 5 &&
    result.headingsKept === 4 &&
    result.shortBlocksWhole === 1 &&
    result.longBlocksSplit === 1 &&
    result.keptAlone === 0
  );
}
