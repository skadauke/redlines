// Debug only: shows that printing holds the whole document, without a print dialog to press. Start
// the page with `VITE_PRINT_CHECK=1` in the environment of `vite` (it reads nothing in a release
// build), and open a document longer than the window. It runs the print path with the dialog held
// open, as a dialog that stays up would, and reports through the console, which `vite` prints.

import type { Editor } from '@redlines/editor';
import { holdWholeDocument, printPage } from './print.ts';

const SETTLE_MS = 2000;

const renderedLines = (editor: Editor) => editor.view.dom.querySelectorAll('.cm-line').length;

export async function runPrintCheck(editor: Editor): Promise<void> {
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
  console.warn(
    `PRINT-CHECK ${JSON.stringify({
      documentLines,
      renderedBeforePrint: before,
      renderedAfter2sWithPrintHeld: renderedLines(editor),
    })}`,
  );
}
