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
  console.warn(`PRINT-CHECK done ${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`);
}
