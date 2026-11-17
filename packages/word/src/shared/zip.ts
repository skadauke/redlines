// A .docx is a zip of XML parts. fflate reads and writes it; parts are kept by name.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type Parts = Record<string, Uint8Array>;

/** The parts of a zip. */
export function readParts(bytes: Uint8Array): Parts {
  return unzipSync(bytes);
}

/** A zip of parts. `[Content_Types].xml` goes first, as Word's own files have it. */
export function writeParts(parts: Parts): Uint8Array {
  const ordered: Parts = {};
  const first = parts['[Content_Types].xml'];
  if (first) ordered['[Content_Types].xml'] = first;
  for (const [name, bytes] of Object.entries(parts)) {
    if (name !== '[Content_Types].xml') ordered[name] = bytes;
  }
  return zipSync(ordered, { level: 6 });
}

/** A part as text, or undefined when the file has none. */
export function partText(parts: Parts, name: string): string | undefined {
  const part = parts[name];
  return part ? strFromU8(part) : undefined;
}

export function setPartText(parts: Parts, name: string, text: string): void {
  parts[name] = strToU8(text);
}
