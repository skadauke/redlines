// Printing a window's page. The editor draws only the lines in view, so a page printed as it is
// would hold one screenful. CodeMirror lays out the whole document while its `printing` flag is set,
// and sets it itself when the page gets `beforeprint`, but then clears it again after 500 ms, and
// never looks at `afterprint`. The system lays the pages out when the print dialog opens or when
// its settings change, which can be later than that. So the page holds the flag itself: from before
// the dialog is asked for until it is done with, which is when the person is working again.

/** What holding the whole document needs of the editor's view. */
export interface HoldableView {
  requestMeasure: () => void;
}

/** How often the hold looks again at CodeMirror's flag. */
export const HOLD_CHECK_MS = 100;

/** CodeMirror's own, private, flag: the part of its view state that says the page is printing. */
interface PrintingFlag {
  viewState: { printing: boolean };
}

/**
 * Makes `view` draw the whole document until the returned function is called. `printing` is
 * CodeMirror's private `viewState` field, which its own `beforeprint` handling sets for 500 ms.
 * There is no public way to ask for that for longer, and it is the one switch that lays out every
 * line, so it is set again whenever CodeMirror has cleared it, and the view measures again.
 */
export function holdWholeDocument(view: HoldableView): () => void {
  const flag = (view as unknown as PrintingFlag).viewState;
  const assert = () => {
    if (flag.printing) return;
    flag.printing = true;
    view.requestMeasure();
  };
  // Laid out in the next frame, which the dialog waits for (`printPage`).
  flag.printing = true;
  view.requestMeasure();
  const timer = setInterval(assert, HOLD_CHECK_MS);
  return () => {
    clearInterval(timer);
    flag.printing = false;
    view.requestMeasure();
  };
}

export interface PrintParts {
  /** The host's print: opens the dialog, and resolves without waiting for it to close. */
  print: () => Promise<void>;
  /** Makes the editor draw the whole document; returns what lets it go (`holdWholeDocument`). */
  hold: () => () => void;
  /** Where a key or a click shows that the person is back in the document. */
  back: readonly EventTarget[];
  /** `requestAnimationFrame`. */
  frame?: (callback: () => void) => unknown;
}

/**
 * Prints the page: the editor draws everything, the dialog is asked for after a frame, and the
 * editor holds until the dialog is done with: the system's `afterprint` if it comes, or else the
 * person's next key or click in `back`, the parts of the window they work in, which can't happen
 * while the sheet is up, so they are back in the document. Nothing else ends it: not a time, and
 * not the window losing and regaining the focus, which app switching does too. Holding costs
 * almost nothing. Resolves once the dialog is asked for; the hold ends later by itself.
 */
export async function printPage({
  print,
  hold,
  back,
  frame = (callback) => requestAnimationFrame(callback),
}: PrintParts): Promise<void> {
  const release = hold();
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', stop);
    for (const part of back) {
      part.removeEventListener('keydown', stop, true);
      part.removeEventListener('mousedown', stop, true);
    }
    release();
  };
  try {
    await new Promise<void>((resolve) => frame(resolve));
    window.addEventListener('afterprint', stop);
    for (const part of back) {
      part.addEventListener('keydown', stop, true);
      part.addEventListener('mousedown', stop, true);
    }
    await print();
  } catch (error) {
    // No dialog will come.
    stop();
    throw error;
  }
}
