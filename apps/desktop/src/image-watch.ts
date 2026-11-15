// Images saved again while the document is open (design §5.10): the person edits one in Preview,
// saves there, and comes back to Redlines, whose document then shows the new image. The app watches
// a document's own file alone (`src-tauri/src/watch.rs`), not the images it shows, so this asks
// when the window regains the focus, which is when the person comes back: each image the preview
// has drawn has a stamp (its modification time and size, `image_stamps` in `src-tauri/src/images.rs`),
// and the ones whose stamp changed are loaded again, from a URL that carries a version, which the
// webview has no copy of. Nothing here ever writes the document: it is the page's pictures that
// change, not its text.

/** The stamp of each file, in order, or null for a file the page may not see or that isn't there. */
export type Stamps = (paths: string[]) => Promise<(string | null)[]>;

export interface ImageWatch {
  /**
   * The URL to load the image at `path` from: `url`, as the host made it, with the version of the
   * image added once it has been saved again. The path is watched from now on.
   */
  url(path: string, url: string): string;
  /** Looks at every image drawn: the paths of those saved again since the last look. */
  check(): Promise<string[]>;
  /** Forgets every image: another document is drawn. */
  forget(): void;
}

/** The URLs that carry a version: the app's own image scheme, which ignores the query. */
const SERVED_BY_THE_APP = /^(asset:|https?:\/\/asset\.localhost)/i;

export function createImageWatch(stamps: Stamps): ImageWatch {
  /** The stamp each drawn image had when last looked at; undefined while it hasn't been. */
  let known = new Map<string, string | null | undefined>();
  /** How many times each image was found saved again. */
  let versions = new Map<string, number>();
  /** The stamps being asked for, for the images that came since the last ask. */
  let learning: Promise<void> = Promise.resolve();
  let epoch = 0;

  /** Asks for the stamp of each image that has none yet, once, for all that came in a moment. */
  const learn = () => {
    const mine = epoch;
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
      if (!known.has(path)) {
        known.set(path, undefined);
        queueMicrotask(learn);
      }
      const version = versions.get(path);
      if (!version || !SERVED_BY_THE_APP.test(url)) return url;
      return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
    },
    async check() {
      const mine = epoch;
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
      known = new Map();
      versions = new Map();
      learning = Promise.resolve();
    },
  };
}
