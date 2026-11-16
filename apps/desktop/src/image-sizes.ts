// The size of each local image, asked of the app once (it reads the file's header, `image_sizes` in
// `src-tauri/src/images.rs`) and kept: the preview holds an image's room before the file loads, so
// that the page doesn't move when it arrives. Questions asked in the same moment go in one call.

export interface Size {
  width: number;
  height: number;
}

/** The size of each file, in order, or null where it isn't known. */
export type Sizes = (paths: string[]) => Promise<(Size | null)[]>;

export interface ImageSizes {
  /** The size of the image file at `path`: at once if known, else when the app has answered. */
  of(path: string): Size | null | Promise<Size | null>;
  /** The files were saved again (or, with none named, another folder is shown): sizes are asked for again. */
  forget(paths?: string[]): void;
}

export function createImageSizes(sizes: Sizes): ImageSizes {
  const known = new Map<string, Size | null>();
  const asked = new Map<string, Promise<Size | null>>();
  let batch: { path: string; done: (size: Size | null) => void }[] = [];

  const flush = () => {
    const mine = batch;
    batch = [];
    const paths = mine.map((item) => item.path);
    sizes(paths).then(
      (found) => mine.forEach((item, i) => item.done(found[i] ?? null)),
      () => mine.forEach((item) => item.done(null)),
    );
  };

  return {
    of(path) {
      if (known.has(path)) return known.get(path) ?? null;
      let pending = asked.get(path);
      if (!pending) {
        pending = new Promise<Size | null>((resolve) => {
          if (batch.length === 0) queueMicrotask(flush);
          batch.push({
            path,
            done: (size) => {
              // A file that isn't there yet may be by the next question.
              if (size) known.set(path, size);
              asked.delete(path);
              resolve(size);
            },
          });
        });
        asked.set(path, pending);
      }
      return pending;
    },
    forget(paths) {
      if (!paths) {
        known.clear();
        asked.clear();
        return;
      }
      for (const path of paths) {
        known.delete(path);
        asked.delete(path);
      }
    },
  };
}
