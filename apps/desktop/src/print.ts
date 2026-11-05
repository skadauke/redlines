// Printing a window's page. The editor draws only the lines in view, so a page printed as it is
// would hold one screenful. CodeMirror lays out the whole document while its `printing` flag is set,
// and sets it itself when the page gets `beforeprint`, but then clears it again after 500 ms, and
// never looks at `afterprint`. The system lays the pages out when the print dialog opens or when
// its settings change, which can be later than that. So the page holds the flag itself: from before
// the dialog is asked for until it is done with, which is when the window has the focus again.

/** What holding the whole document needs of the editor's view. */
export interface HoldableView {
  requestMeasure: () => void;
}

/** How often the hold looks again at CodeMirror's flag. */
export const HOLD_CHECK_MS = 100;

/** A dialog that has not given the focus back by now is taken to be gone. */
export const HOLD_LIMIT_MS = 120_000;

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
  /** `requestAnimationFrame`. */
  frame?: (callback: () => void) => unknown;
}

/**
 * Prints the page: the editor draws everything, the dialog is asked for after a frame, and the
 * editor holds until the dialog is done with: the system's `afterprint`, or the window getting
 * its focus back after losing it to the dialog, or the limit. Resolves once the dialog is asked
 * for; the hold ends later by itself.
 */
export async function printPage({
  print,
  hold,
  frame = (callback) => requestAnimationFrame(callback),
}: PrintParts): Promise<void> {
  const release = hold();
  let done = false;
  let limit: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(limit);
    window.removeEventListener('afterprint', stop);
    window.removeEventListener('blur', blurred);
    window.removeEventListener('focus', refocused);
    release();
  };
  let wasAway = false;
  const blurred = () => (wasAway = true);
  const refocused = () => {
    if (wasAway) stop();
  };
  try {
    await new Promise<void>((resolve) => frame(resolve));
    window.addEventListener('afterprint', stop);
    window.addEventListener('blur', blurred);
    window.addEventListener('focus', refocused);
    limit = setTimeout(stop, HOLD_LIMIT_MS);
    await print();
  } catch (error) {
    // No dialog will come, and none will give the focus back.
    stop();
    throw error;
  }
}
