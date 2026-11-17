// What lets a .docx that Redlines wrote be read back exactly, where nothing was touched: the
// source part, the block bookmarks, and the durable ids and true times of comments and revisions.

import { strFromU8, strToU8 } from 'fflate';
import type { Parts } from '../shared/zip.ts';
import { addCommentParts, withDateUtc } from './comments.ts';
import type { CommentCarrier } from './comments.ts';
import { addSource, linkSource } from './source.ts';
import type { Source } from './source.ts';

export type { CommentCarrier } from './comments.ts';
export { bookmarkName, readSource, readSourceXml, sourceXml, survivingBlocks } from './source.ts';
export type { Source, SourceBlock } from './source.ts';

export interface Carriers extends Source {
  comments: CommentCarrier[];
}

/** Writes the carriers into a file's parts. */
export function addCarriers(parts: Parts, carriers: Carriers): void {
  const { comments, ...source } = carriers;
  addSource(parts, source);
  linkSource(parts);
  addCommentParts(parts, comments);
  const document = parts['word/document.xml'];
  if (document) parts['word/document.xml'] = strToU8(withDateUtc(strFromU8(document)));
}
