// A window shows the editor or a read-only viewer (v0.2 design: The file sidebar). The viewer is for
// a text file other than Markdown, and takes the editor's place on the page; the editor and its
// document stay as they were under it, unsaved edits and all, and come back when the viewer goes.

import { createFileViewer, MAX_VIEW_BYTES, type FileViewer } from '@redlines/code';
import { basename, NotUtf8Error, type Host } from './host.ts';

/** The file the viewer shows. */
export interface Viewing {
  path: string;
  name: string;
}

export interface ViewerSwapOptions {
  host: Pick<Host, 'readCapped'>;
  /** Where the viewer is drawn. It is hidden until a file shows. */
  viewerHost: HTMLElement;
  /** What the viewer takes the place of: the editor's scroller. */
  editorSide: HTMLElement;
  /** Tells the person what went wrong, in one line. */
  notice(message: string): void;
  /** Called after the viewer appears, changes its file or goes (null): the window's chrome follows. */
  onChange(viewing: Viewing | null): void;
}

export interface ViewerSwap {
  /** The file shown, or null while the editor is. */
  readonly current: Viewing | null;
  /** Shows the file at `path`, at `line` (counted from 1) when a citation names one. */
  show(path: string, line?: number): Promise<void>;
  /** Takes the viewer away and shows the editor again; does nothing when it isn't showing. */
  close(): void;
  /** Measures the viewer's text again, after its size changed. */
  requestMeasure(): void;
}

export function createViewerSwap(options: ViewerSwapOptions): ViewerSwap {
  const { host, viewerHost, editorSide } = options;
  let current: (Viewing & { viewer: FileViewer }) | null = null;
  /** Bumped by each ask, so that an older read that finishes late is dropped. */
  let requests = 0;

  const remove = () => {
    current?.viewer.destroy();
    current = null;
  };

  return {
    get current() {
      return current && { path: current.path, name: current.name };
    },
    async show(path, line) {
      const request = ++requests;
      let file: { text: string | null; tooLarge?: true };
      try {
        const read = await host.readCapped(path, MAX_VIEW_BYTES);
        file = 'tooLarge' in read ? { text: null, tooLarge: true } : { text: read.text };
      } catch (error) {
        if (!(error instanceof NotUtf8Error)) {
          console.error('Could not read the file for the viewer', error);
          if (request === requests) options.notice(`Couldn’t open “${basename(path)}”.`);
          return;
        }
        file = { text: null };
      }
      if (request !== requests) return;
      remove();
      const name = basename(path);
      current = { path, name, viewer: createFileViewer(viewerHost, { name, line, ...file }) };
      editorSide.hidden = true;
      viewerHost.hidden = false;
      options.onChange({ path, name });
    },
    close() {
      requests++;
      if (!current) return;
      remove();
      viewerHost.hidden = true;
      editorSide.hidden = false;
      options.onChange(null);
    },
    requestMeasure() {
      current?.viewer.requestMeasure();
    },
  };
}
