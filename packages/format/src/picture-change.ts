// A picture's own changes (#1197): a substitution whose old and new text are each one picture (a
// resize, an alignment, a new description) is read as that, so that a view draws the picture at its
// new size with the change marked and never shows the old source, and a card says what happened.

/** What a picture's source says of it. */
export interface Picture {
  src: string;
  alt: string;
  /** The width it is given, as written (`400`, `50%`), or null. */
  width: string | null;
  /** Everything else it says (alignment, class, other attributes), for comparing. */
  rest: string;
}

const MD_IMAGE =
  /^!\[((?:\\.|[^\]\\\n])*)\]\(((?:\\.|[^()\\\n]|\([^()\n]*\))*)\)(?:\{([^}\n]*)\})?$/;
const TAG_IMAGE = /^<img\b([^<>]*?)\/?>$/i;
const ATTRIBUTE = /([a-zA-Z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** The picture that `text` is, all of it: a Markdown image or an `<img>` tag; else null. */
export function pictureOf(text: string): Picture | null {
  const source = text.trim();
  const md = MD_IMAGE.exec(source);
  if (md) {
    const [, alt = '', inside = '', block = ''] = md;
    const src = inside.trim().replace(/\s+"[^"]*"$/, '');
    const attributes = block.trim();
    const width = /(?:^|\s)width\s*=\s*"?([^\s"}]+)"?/.exec(attributes)?.[1] ?? null;
    const rest = attributes.replace(/(?:^|\s)width\s*=\s*"?[^\s"}]+"?/, '').trim();
    return { src, alt, width, rest };
  }
  const tag = TAG_IMAGE.exec(source);
  if (!tag) return null;
  const found = new Map<string, string>();
  for (const match of (tag[1] ?? '').matchAll(ATTRIBUTE)) {
    found.set((match[1] ?? '').toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  const src = found.get('src');
  if (src === undefined) return null;
  const rest = [...found.entries()]
    .filter(([name]) => name !== 'src' && name !== 'alt' && name !== 'width')
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join(' ');
  return { src, alt: found.get('alt') ?? '', width: found.get('width') ?? null, rest };
}

/** An alt as text: a Markdown escape and an HTML entity read as the character. */
const plainAlt = (alt: string) =>
  alt
    .replace(/\\(.)/g, '$1')
    .replace(
      /&(lt|gt|quot|amp);/g,
      (_, name: string) => ({ lt: '<', gt: '>', quot: '"', amp: '&' })[name] ?? '',
    );

/**
 * What a substitution of one picture by another did, in a card's words: `Resized picture` when only
 * its width differs, `Changed picture` for any other difference. Null when either side is not one
 * picture.
 */
export function describePictureChange(old: string, added: string): string | null {
  const before = pictureOf(old);
  const after = pictureOf(added);
  if (!before || !after) return null;
  if (
    before.src === after.src &&
    plainAlt(before.alt) === plainAlt(after.alt) &&
    before.rest === after.rest
  ) {
    return before.width === after.width ? 'Changed picture' : 'Resized picture';
  }
  return 'Changed picture';
}
