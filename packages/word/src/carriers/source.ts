// The custom XML part that carries the Markdown file inside the .docx (import.md, "Keeping the
// Markdown intact on a round trip"): the original text, its ledger, and the blocks the exporter
// wrote with the places they came from. An import restores every block that has no revisions
// from `markdown`, byte for byte, and takes the people and the marks' ids from `ledger`.
//
// Word keeps a custom XML part it doesn't understand when it saves, and may rename it
// (`item1.xml`), so a reader finds it by its root element, never by its name.

import type { Ledger } from '@redlines/format';
import { strFromU8, strToU8 } from 'fflate';
import type { Parts } from '../shared/zip.ts';
import { elementOf, elementsOf, escapeXml, unescapeXml, xmlSafe } from './xml.ts';

/** The part's namespace, and so its schema reference. Bump the number on a change that an older
 * reader would misread. */
const SOURCE_NAMESPACE = 'urn:redlines:source:1';

/** The name the exporter gives the part. */
const SOURCE_PART = 'customXml/redlines-source.xml';

const ITEM_PROPS = 'customXml/itemProps-redlines-source.xml';
const CUSTOM_XML_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const PROPS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';
const PROPS_TYPE = 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';

/** A block of the Markdown that the exporter wrote as a paragraph or a table, with the bookmark
 * that wraps it (`_rl_<id>`) and where it lies in `markdown` (UTF-16 offsets). */
export interface SourceBlock {
  id: string;
  type: string;
  from: number;
  to: number;
}

export interface Source {
  markdown: string;
  ledger: Ledger;
  blocks: SourceBlock[];
}

/** The bookmark name of a block. A name that starts with an underscore is hidden in Word. */
export function bookmarkName(id: string): string {
  return `_rl_${id}`;
}

/** The block ids of the bookmarks in a document part, in the order they stand. */
export function survivingBlocks(documentXml: string): string[] {
  return elementsOf(documentXml, 'bookmarkStart')
    .map((attributes) => /^_rl_(.+)$/.exec(attributes['name'] ?? '')?.[1])
    .filter((id): id is string => id !== undefined);
}

function hashes(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + a, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/** The part's XML. */
export function sourceXml(source: Source): string {
  const safe = xmlSafe(source.markdown);
  const markdown = safe ? escapeXml(source.markdown) : base64(strToU8(source.markdown));
  const blocks = source.blocks
    .map(
      (block) =>
        `<rl:block id="${escapeXml(block.id)}" type="${escapeXml(block.type)}" from="${block.from}" to="${block.to}"/>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<rl:source xmlns:rl="${SOURCE_NAMESPACE}" version="1">` +
    `<rl:markdown${safe ? '' : ' encoding="base64"'} xml:space="preserve">${markdown}</rl:markdown>` +
    `<rl:ledger>${escapeXml(
      JSON.stringify(source.ledger).replace(
        /[\ufffe\uffff]/g,
        (char) => `\\u${char.charCodeAt(0).toString(16)}`,
      ),
    )}</rl:ledger>` +
    `<rl:blocks>${blocks}</rl:blocks>` +
    `</rl:source>`
  );
}

/** What a part holds, or undefined when it isn't ours or can't be read. */
export function readSourceXml(xml: string): Source | undefined {
  if (!xml.includes(SOURCE_NAMESPACE)) return undefined;
  const markdown = elementOf(xml, 'markdown');
  const ledger = elementOf(xml, 'ledger');
  if (!markdown || !ledger) return undefined;
  try {
    const text = unescapeXml(markdown.inner);
    const decoded =
      markdown.attributes['encoding'] === 'base64'
        ? strFromU8(Uint8Array.from(atob(text.trim()), (char) => char.charCodeAt(0)))
        : text;
    const blocks = elementsOf(elementOf(xml, 'blocks')?.inner ?? '', 'block').map((block) => ({
      id: block['id'] ?? '',
      type: block['type'] ?? '',
      from: Number(block['from']),
      to: Number(block['to']),
    }));
    return {
      markdown: decoded,
      ledger: JSON.parse(unescapeXml(ledger.inner)) as Ledger,
      blocks: blocks.filter((block) => block.id !== '' && block.to >= block.from),
    };
  } catch {
    return undefined;
  }
}

/** The source in a file's parts, wherever the part is now called. */
export function readSource(parts: Parts): Source | undefined {
  const names = Object.keys(parts).filter(
    (name) => name.startsWith('customXml/') && name.endsWith('.xml') && !name.includes('Props'),
  );
  names.sort((a, b) => (a === SOURCE_PART ? -1 : b === SOURCE_PART ? 1 : 0));
  for (const name of names) {
    const found = readSourceXml(strFromU8(parts[name] as Uint8Array));
    if (found) return found;
  }
  return undefined;
}

/** Puts the part, its properties and the links to them in a file's parts. */
export function addSource(parts: Parts, source: Source): void {
  parts[SOURCE_PART] = strToU8(sourceXml(source));

  // The properties give the item an id and name its schema, as Word's own custom parts have.
  const digest = hashes(source.markdown) + hashes(JSON.stringify(source.blocks));
  const guid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(12, 15)}`,
    `8${digest.slice(15, 18)}`,
    digest.slice(18, 30),
  ].join('-');
  parts[ITEM_PROPS] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<ds:datastoreItem ds:itemID="{${guid.toUpperCase()}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
      `<ds:schemaRefs><ds:schemaRef ds:uri="${SOURCE_NAMESPACE}"/></ds:schemaRefs></ds:datastoreItem>`,
  );
  parts['customXml/_rels/redlines-source.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${PROPS_REL}" Target="itemProps-redlines-source.xml"/></Relationships>`,
  );
}

/** The relationship in `word/_rels/document.xml.rels` that ties the part to the document, and the
 * content type of the properties. */
export function linkSource(parts: Parts): void {
  const relsName = 'word/_rels/document.xml.rels';
  const rels = strFromU8(parts[relsName] ?? strToU8(''));
  const link = `<Relationship Id="rIdRedlinesSource" Type="${CUSTOM_XML_REL}" Target="../${SOURCE_PART}"/>`;
  parts[relsName] = strToU8(
    rels.includes('</Relationships>')
      ? rels.replace('</Relationships>', `${link}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${link}</Relationships>`,
  );
  const typesName = '[Content_Types].xml';
  const types = strFromU8(parts[typesName] as Uint8Array);
  parts[typesName] = strToU8(
    types.replace(
      '</Types>',
      `<Override PartName="/${ITEM_PROPS}" ContentType="${PROPS_TYPE}"/></Types>`,
    ),
  );
}
