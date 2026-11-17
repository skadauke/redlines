// Debug only: shows that a printed page holds the whole document, without a print dialog to press.
// Start the page with `VITE_PRINT_CHECK=1` in the environment of `vite` (it reads nothing in a
// release build), and open a document longer than the window. It fills the print container as the
// print path does, and reports through the console, which `vite` prints: how many blocks and
// images the page holds against the document's own, that no mark of Redlines is in it, and that
// the print stylesheet shows the container and hides the window (matchMedia can't switch to print,
// so the container's rule is read from the sheets).

import { editorDocumentHtml, type Editor } from '@redlines/editor';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { fillPrintPage, printContainer } from './print.ts';

const SETTLE_MS = 1000;

export async function runPrintCheck(editor: Editor): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const source = editor.getDoc();
  const release = await fillPrintPage(editorDocumentHtml(editor.view));
  const page = printContainer();
  const images = Array.from(page.querySelectorAll('img'));
  const rules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
    .filter((rule) => rule.media.mediaText.includes('print'));
  console.warn(
    `PRINT-CHECK ${JSON.stringify({
      documentLines: source.split('\n').length,
      pageText: page.textContent?.length ?? 0,
      blocks: page.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, tr, pre').length,
      tables: page.querySelectorAll('table').length,
      images: images.length,
      imagesLoaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      marks: page.querySelectorAll('ins, del, mark, [class*="rl-bar"], [class*="rl-mark"]').length,
      markers: /<!--/.test(page.innerHTML),
      printRules: rules.length,
    })}`,
  );
  // In the app, a debug build started with REDLINES_EXPORT_PDF=<path> writes the paginated PDF there.
  if (isTauri()) {
    const path = await invoke<string | null>('export_pdf', { name: 'check.pdf', folder: null });
    console.warn(`PRINT-CHECK pdf ${path ?? 'cancelled'}`);
  }
  release();
}
