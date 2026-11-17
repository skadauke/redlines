// Debug only: shows that printing holds the whole document, without a print dialog to press. Start
// the page with `VITE_PRINT_CHECK=1` in the environment of `vite` (it reads nothing in a release
// build). It loads a document much longer than the window (the sample is not: the editor draws all
// of it, so nothing could be shown), runs the print path with the dialog held open, as a dialog that
// stays up would, and reports through the console, which `vite` prints: the numbers on a
// `PRINT-CHECK` line, then `PRINT-CHECK done <passed> passed, <failed> failed`.

import type { Editor } from '@redlines/editor';
import { holdWholeDocument, printPage } from './print.ts';

const SETTLE_MS = 2000;

const renderedLines = (editor: Editor) => editor.view.dom.querySelectorAll('.cm-line').length;

/** The paragraphs of the long document: far more lines than any window holds. */
const PARAGRAPHS = 800;

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
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const documentLines = editor.getDoc().split('\n').length;
  const before = renderedLines(editor);
  // A dialog that never comes back: the print command's promise is resolved, the dialog stays up.
  void printPage({
    print: () => Promise.resolve(),
    hold: () => holdWholeDocument(editor.view),
    back: [],
  });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const after = renderedLines(editor);
  console.warn(
    `PRINT-CHECK ${JSON.stringify({
      documentLines,
      renderedBeforePrint: before,
      renderedAfter2sWithPrintHeld: after,
    })}`,
  );
  // The window's own end of the dialog, which lets the hold go.
  window.dispatchEvent(new Event('afterprint'));
  // The editor drew only what is near the window before, and every paragraph with the print held.
  const ok = before > 0 && before < PARAGRAPHS / 2 && after >= PARAGRAPHS;
  console.warn(`PRINT-CHECK done ${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed`);
}
