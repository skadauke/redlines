// Printing a window's page. The editor draws only the lines in view, so a page printed as it is
// would hold one screenful. CodeMirror lays out the whole document when the window gets a
// `beforeprint` event, which the system sends once the print dialog is open, too late for the
// dialog's first preview: so the event is sent here first, and the dialog waits for the frame in
// which the editor answers. The editor is expected to be put back by the system's own
// `afterprint` when the dialog closes (not yet checked in the real app).

/** Prints with `print` (the host's) once the page is ready. `frame` is `requestAnimationFrame`. */
export async function printPage(
  print: () => Promise<void>,
  frame: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
): Promise<void> {
  window.dispatchEvent(new Event('beforeprint'));
  await new Promise<void>((resolve) => frame(resolve));
  try {
    await print();
  } catch (error) {
    // No dialog will come to send `afterprint`.
    window.dispatchEvent(new Event('afterprint'));
    throw error;
  }
}
