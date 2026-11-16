// Images saved again while the document is open (design §5.10): the person edits one in Preview,
// saves there, and comes back to Redlines, whose document then shows the new image. The app watches
// a document's own file alone (`src-tauri/src/watch.rs`), not the images it shows, so this asks
// when the window regains the focus, which is when the person comes back: each image the preview
// has drawn has a stamp (its modification time and size, `image_stamps` in `src-tauri/src/images.rs`),
// and the ones whose stamp changed are loaded again, from a URL that carries a version, which the
// webview has no copy of. Nothing here ever writes the document: it is the page's pictures that
// change, not its text.
//
// The webview keeps every image it has loaded for as long as the page lives, whatever the answer's
// cache headers say (WebKit reuses a URL that the document has already loaded), so an image that
// changed on disk is shown again only from a URL it hasn't loaded. Two things make one: the version
// of an image found saved again, and the number of the document's opening: a document opened again
// loads its images from URLs of its own, however the files changed while it was closed (#677).
/** The stamp of each file, in order, or null for a file the page may not see or that isn't there. */
export type Stamps = (paths: string[]) => Promise<(string | null)[]>;

export interface ImageWatch {
  /**
   * The URL to load the image at `path` from: `url`, as the host made it, with the number of this
   * opening of the document and the version of the image (how many times it was found saved again).
   * It only notes that the path is drawn, which is all a drawing may do.
   */
  url(path: string, url: string): string;
  /** The images are about to be drawn again: those that are drawn then are the ones to watch. */
  begin(): void;
  /**
   * Looks at the images drawn since `begin`, and stops watching the rest (a path typed one letter at
   * a time, an image taken out of the text): the paths of those saved again since the last look.
   */
  check(): Promise<string[]>;
  /** Takes the stamp of the images drawn, soon, for those that came since: not at the drawing. */
  settle(): void;
  /** Another document is drawn, or this one again: its images load from URLs the webview hasn't seen. */
  forget(): void;
}

/** The URLs that carry a version: the app's own image scheme, which ignores the query. */
const SERVED_BY_THE_APP = /^(asset:|https?:\/\/asset\.localhost)/i;

/** How long after the last change to the drawing the stamps of new images are taken. */
const SETTLE_MS = 500;

export function createImageWatch(stamps: Stamps): ImageWatch {
  /** The stamp each watched image had when last looked at; undefined while it hasn't been. */
  let known = new Map<string, string | null | undefined>();
  /** The images drawn since `begin` (or since the document began). */
  let drawn = new Set<string>();
  /**
   * How many times each image was found saved again, for the whole session: a document that comes
   * back loads from the URL the webview last saw, not from one it may have a copy of.
   */
  const versions = new Map<string, number>();
  /** How many documents have been opened: the images of each load from URLs of their own. */
  let opening = 0;
  let learning: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let epoch = 0;

  /** Asks for the stamp of each drawn image that has none yet. */
  const learn = () => {
    const mine = epoch;
    for (const path of drawn) if (!known.has(path)) known.set(path, undefined);
    learning = learning.then(async () => {
      const fresh = [...known].filter(([, stamp]) => stamp === undefined).map(([path]) => path);
      if (!fresh.length) return;
      const found = await stamps(fresh).catch(() => fresh.map(() => null));
      if (mine !== epoch) return;
      fresh.forEach((path, at) => {
        known.set(path, found[at] ?? null);
      });
    });
  };

  return {
    url(path, url) {
      drawn.add(path);
      if (!SERVED_BY_THE_APP.test(url)) return url;
      return `${url}${url.includes('?') ? '&' : '?'}v=${opening}.${versions.get(path) ?? 0}`;
    },
    begin() {
      drawn = new Set();
    },
    settle() {
      clearTimeout(timer);
      timer = setTimeout(learn, SETTLE_MS);
    },
    async check() {
      const mine = epoch;
      clearTimeout(timer);
      for (const path of known.keys()) if (!drawn.has(path)) known.delete(path);
      learn();
      await learning;
      const paths = [...known.keys()];
      if (!paths.length || mine !== epoch) return [];
      const now = await stamps(paths).catch(() => null);
      if (!now || mine !== epoch) return [];
      const changed: string[] = [];
      paths.forEach((path, at) => {
        const stamp = now[at] ?? null;
        // A file that is gone keeps showing the picture it had.
        if (stamp === null || stamp === known.get(path)) return;
        known.set(path, stamp);
        versions.set(path, (versions.get(path) ?? 0) + 1);
        changed.push(path);
      });
      return changed;
    },
    forget() {
      epoch += 1;
      opening += 1;
      clearTimeout(timer);
      known = new Map();
      drawn = new Set();
      learning = Promise.resolve();
    },
  };
}
