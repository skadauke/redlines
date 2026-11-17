// Small XML helpers for the parts we write ourselves, and the one reader the round trip needs.
// The carrier parts are ours, so the reader is a plain pattern match that ignores namespace
// prefixes (an app that saves the part again may choose another prefix).

/** Text for an element's content or an attribute's value. A carriage return is a character
 * reference, since a parser turns a bare one into a line feed. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;');
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text that `escapeXml` made, with CDATA sections and character references read. */
export function unescapeXml(text: string): string {
  return text.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>|&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g,
    (_, cdata: string | undefined, hex: string | undefined, dec: string | undefined, name) => {
      if (cdata !== undefined) return cdata;
      if (name) return NAMED[name as string] as string;
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec as string, 10);
      return Number.isNaN(code) || code > 0x10ffff ? '' : String.fromCodePoint(code);
    },
  );
}

/** Whether XML 1.0 can hold the text as it is: no control characters but tab and the line ends,
 * and no lone surrogates. */
export function xmlSafe(text: string): boolean {
  return !/[^\P{Cc}\t\n\r]|[\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(
    text,
  );
}

/** The attributes of a start tag's text, by local name (`rl:id="b1"` is `id`). */
export function attributesOf(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/\s(?:[\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    found[match[1] as string] = unescapeXml((match[2] ?? match[3]) as string);
  }
  return found;
}

/** The first element with a local name: its start tag's attributes and its inner text. */
export function elementOf(
  xml: string,
  local: string,
): { attributes: Record<string, string>; inner: string } | undefined {
  const pattern = new RegExp(
    `<((?:[\\w.-]+:)?${local})((?:\\s[^>]*?)?)(?:/>|>([\\s\\S]*?)</\\1\\s*>)`,
  );
  const found = pattern.exec(xml);
  if (!found) return undefined;
  return { attributes: attributesOf(`<x${found[2] ?? ''}`), inner: found[3] ?? '' };
}

/** The start tags of every element with a local name, as attributes. */
export function elementsOf(xml: string, local: string): Record<string, string>[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${local}((?:\\s[^>]*?)?)/?>`, 'g');
  return [...xml.matchAll(pattern)].map((found) => attributesOf(`<x${found[1] ?? ''}`));
}
