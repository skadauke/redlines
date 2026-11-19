// The comment parts Word writes beside `comments.xml` and the true UTC time of every revision.
//
// - `commentsExtended.xml`: reply threading (`paraIdParent`) and resolved (`done`). `docx` writes
//   it only when some comment has a parent, which loses the resolved flag of a lone thread, so it
//   is written here for every file with comments.
// - `commentsIds.xml`: the durable id of each comment, which Word keeps across saves. `docx`
//   writes it; the ids come from the Redlines ids (`durableId`).
// - `commentsExtensible.xml`: the durable id again, with `w16cex:dateUtc`, the comment's time in
//   UTC. `w:date` is local time with a false `Z` once Word has saved it.
// - `w16du:dateUtc` on every revision, for the same reason (word.md, "Identity, ids and time").

import { strFromU8, strToU8 } from 'fflate';
import type { Parts } from '../shared/zip.ts';
import { escapeXml } from './xml.ts';

export interface CommentCarrier {
  /** The paragraph id of the comment's last paragraph, `w14:paraId`. */
  paraId: string;
  /** The paragraph id of the thread's first comment, for a reply. */
  parentParaId?: string;
  resolved: boolean;
  durableId: string;
  /** `2026-10-13T22:40:00Z`. */
  dateUtc: string;
}

const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const W16CID = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
const W16CEX = 'http://schemas.microsoft.com/office/word/2018/wordml/cex';
const W16DU = 'http://schemas.microsoft.com/office/word/2023/wordml/word16du';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const REL_BASE = 'word/_rels/document.xml.rels';
const PARTS = {
  extended: {
    name: 'word/commentsExtended.xml',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml',
    rel: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  },
  ids: {
    name: 'word/commentsIds.xml',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml',
    rel: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  },
  extensible: {
    name: 'word/commentsExtensible.xml',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml',
    rel: 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
  },
} as const;

/** `word/commentsExtended.xml`. */
function commentsExtendedXml(comments: CommentCarrier[]): string {
  const items = comments
    .map(
      (comment) =>
        `<w15:commentEx w15:paraId="${comment.paraId}"` +
        (comment.parentParaId ? ` w15:paraIdParent="${comment.parentParaId}"` : '') +
        ` w15:done="${comment.resolved ? 1 : 0}"/>`,
    )
    .join('');
  return `${HEAD}<w15:commentsEx xmlns:mc="${MC}" xmlns:w15="${W15}" mc:Ignorable="w15">${items}</w15:commentsEx>`;
}

/** `word/commentsIds.xml`. */
function commentsIdsXml(comments: CommentCarrier[]): string {
  const items = comments
    .map(
      (comment) =>
        `<w16cid:commentId w16cid:paraId="${comment.paraId}" w16cid:durableId="${comment.durableId}"/>`,
    )
    .join('');
  return `${HEAD}<w16cid:commentsIds xmlns:mc="${MC}" xmlns:w16cid="${W16CID}" mc:Ignorable="w16cid">${items}</w16cid:commentsIds>`;
}

/** `word/commentsExtensible.xml`. */
function commentsExtensibleXml(comments: CommentCarrier[]): string {
  const items = comments
    .map(
      (comment) =>
        `<w16cex:commentExtensible w16cex:durableId="${comment.durableId}" w16cex:dateUtc="${escapeXml(comment.dateUtc)}"/>`,
    )
    .join('');
  return `${HEAD}<w16cex:commentsExtensible xmlns:mc="${MC}" xmlns:w16cex="${W16CEX}" mc:Ignorable="w16cex">${items}</w16cex:commentsExtensible>`;
}

/** Adds `w16du:dateUtc` next to every `w:date` of a document part, and tells Word's older
 * versions to ignore it. The dates we write are UTC already, so the two are the same. */
export function withDateUtc(documentXml: string): string {
  if (!/\sw:date="/.test(documentXml)) return documentXml;
  const marked = documentXml.replace(
    /(<w:[A-Za-z]+\s[^>]*?)\sw:date="([^"]*)"/g,
    (_, head: string, date: string) => `${head} w:date="${date}" w16du:dateUtc="${date}"`,
  );
  return marked.replace(/<w:document\b[^>]*>/, (tag) => {
    let next = tag.includes('xmlns:w16du=') ? tag : tag.replace(/>$/, ` xmlns:w16du="${W16DU}">`);
    next = /mc:Ignorable="([^"]*)"/.test(next)
      ? next.replace(/mc:Ignorable="([^"]*)"/, (_, list: string) =>
          list.split(/\s+/).includes('w16du')
            ? `mc:Ignorable="${list}"`
            : `mc:Ignorable="${list} w16du"`,
        )
      : next.replace(/>$/, ` mc:Ignorable="w16du">`);
    return next;
  });
}

/** Writes the three comment parts, replacing what `docx` wrote, and registers each. */
export function addCommentParts(parts: Parts, comments: CommentCarrier[]): void {
  if (comments.length === 0) return;
  const bodies = {
    extended: commentsExtendedXml(comments),
    ids: commentsIdsXml(comments),
    extensible: commentsExtensibleXml(comments),
  };
  let rels = strFromU8(parts[REL_BASE] as Uint8Array);
  let types = strFromU8(parts['[Content_Types].xml'] as Uint8Array);
  for (const key of ['extended', 'ids', 'extensible'] as const) {
    const part = PARTS[key];
    parts[part.name] = strToU8(bodies[key]);
    const target = part.name.slice('word/'.length);
    if (!rels.includes(`Target="${target}"`)) {
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="rIdRedlines${key}" Type="${part.rel}" Target="${target}"/></Relationships>`,
      );
    }
    if (!types.includes(`PartName="/${part.name}"`)) {
      types = types.replace(
        '</Types>',
        `<Override PartName="/${part.name}" ContentType="${part.type}"/></Types>`,
      );
    }
  }
  parts[REL_BASE] = strToU8(rels);
  parts['[Content_Types].xml'] = strToU8(types);
}
