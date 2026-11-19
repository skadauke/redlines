// Help › Write to Log… (dev builds only, #1205): a sheet, as the alert's, that asks for a line to
// say what is odd, and answers with it, or null when it is cancelled. Return writes, Escape cancels.

export interface DevNoteOptions {
  container: HTMLElement;
  /** Gives the keyboard back to the editor when the sheet closes. */
  restoreFocus: () => void;
}

export function askDevNote(options: DevNoteOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'rl-sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'rl-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'rl-dev-note-title');
    const title = document.createElement('div');
    title.id = 'rl-dev-note-title';
    title.className = 'rl-sheet-title';
    title.textContent = 'Write to Log';
    const detail = document.createElement('div');
    detail.className = 'rl-sheet-detail';
    detail.textContent =
      'What is odd? The note goes in the dev log with the document’s hash, the selection and the last keys, but no text of the document.';
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'rl-sheet-field';
    field.setAttribute('aria-label', 'Note');
    field.maxLength = 300;
    const buttons = document.createElement('div');
    buttons.className = 'rl-sheet-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rl-sheet-button';
    cancel.textContent = 'Cancel';
    const write = document.createElement('button');
    write.type = 'button';
    write.className = 'rl-sheet-button rl-sheet-default';
    write.textContent = 'Write';
    buttons.append(cancel, write);
    sheet.append(title, detail, field, buttons);
    backdrop.append(sheet);
    options.container.append(backdrop);
    field.focus();

    const done = (note: string | null) => {
      backdrop.remove();
      options.restoreFocus();
      resolve(note);
    };
    cancel.addEventListener('click', () => done(null));
    write.addEventListener('click', () => done(field.value));
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        done(null);
      } else if (event.key === 'Enter' && event.target !== cancel) {
        event.preventDefault();
        done(field.value);
      }
    });
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) event.preventDefault();
    });
  });
}
