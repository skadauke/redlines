// A Quarto document as the Markdown that the Word export reads (#1215). Word has no callout, no
// cross-reference and no heading attribute, and the export read them as the text they are written
// as. This writes what each one is in Word's own terms, before the file is parsed:
//
// - a callout (`::: {.callout-note}` … `:::`) is a quote that starts with its title in bold; the
//   fences of any other div are dropped and its paragraphs stay apart;
// - the attributes of a heading, a picture or a caption (`{#sec-intro}`) are dropped, and the
//   caption of a table (`: Who owns what {#tbl-owners}`) is a paragraph, "Table 1: Who owns what";
// - a reference (`@fig-sketch`) is its label, as Quarto prints it ("Figure 1"), numbered in the
//   order the targets are written;
// - a display formula (`$$ E = mc^2 $$ {#eq-mass}`) is a paragraph of its TeX, numbered. It is not
//   typeset: Word's own equations are not written by the export;
// - `x^2^` and `H~2~O` are a superscript and a subscript.
//
// Code (a fence, a code span), the front matter and the ledger are never touched. A document with
// none of Quarto's syntax is returned as it is. The text that comes out is no longer the file's, so
// the export leaves the carriers of a round trip out of it and says so.

import {
  bibliographyRefs,
  formatBracket,
  formatNarrative,
  makeContext,
  parseBibliography,
  parseBracket,
  styleOfCsl,
} from '@redlines/citations';
import type { Bibliography, StyleName } from '@redlines/citations';

/** The bibliography of a document and the style its citations are printed in. */
export interface Citations {
  bib: Bibliography;
  style: StyleName;
}

const XREF = /^(?:fig|tbl|sec|eq|lst|thm|lem|cor|prp|cnj|def|exm|exr|nte|tip|wrn|cau|imp)-/;
/** A citation in brackets, or one that is part of the sentence (`@smith2020`). */
const CITATION =
  /\[(?=[^\][\n]*-?@)[^\][\n]*\]|(?<![\w@\]])@([\w][\w:.#$%&+?<>~/-]*)(?<![:.#$%&+?<>~/-])/g;

const LEDGER = /\n<!-- redlines\n[\s\S]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})/;
const OPEN_DIV = /^(:{3,})\s*(\{[^}]*\}|[\w-]+)\s*$/;
const CLOSE_DIV = /^:{3,}\s*$/;
const ATTRIBUTES = /\s*\{[#.][^{}]*\}\s*$/;
const ID = /\{[^{}]*#((?:sec|fig|tbl|eq|lst)-[\w:.-]*\w)[^{}]*\}/;
/** `$x^2$`, as pandoc reads it: no space inside the dollars, no digit after the closing one. */
const INLINE_MATH = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<![\s\\])\$(?![\d$])/g;
const CALLOUT = /\.callout-(note|tip|warning|important|caution)\b/;
const REFERENCE = /(?<![\w@/.\\])@((?:sec|fig|tbl|eq|lst)-[\w:.-]*\w)/g;

const NAMES: Record<string, string> = {
  sec: 'Section',
  fig: 'Figure',
  tbl: 'Table',
  eq: 'Equation',
  lst: 'Listing',
};

/** Whether a text has Quarto's own syntax: a callout, a cross-reference target or a code chunk. */
export function isQuarto(text: string): boolean {
  return (
    /^:{3,}\s*\{[^}]*\.callout-/m.test(text) ||
    /\{[^{}]*#(?:sec|fig|tbl|eq|lst)-[\w:.-]+[^{}]*\}/.test(text) ||
    /^ {0,3}(?:`{3,}|~{3,})\{[a-z]+/m.test(text) ||
    // Citations that a bibliography prints.
    (bibliographyRefs(text) !== undefined && /\[[^\]\n]*@\w/.test(text))
  );
}

/** A text's lines that are code (inside a fence), as a flag for each. */
function codeFlags(lines: string[]): boolean[] {
  const flags: boolean[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    const found = FENCE.exec(line);
    if (fence) {
      flags.push(true);
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
    } else if (found) {
      flags.push(true);
      fence = { char: found[2]![0]!, length: found[2]!.length };
    } else flags.push(false);
  }
  return flags;
}

/** `text` with `change` applied to the stretches outside code spans. */
function outsideSpans(text: string, change: (plain: string) => string): string {
  return text
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : change(part)))
    .join('');
}

/** A heading's text, to put a callout's title from. */
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

/** The text of a Quarto document as the Markdown the Word export reads. */
export function quartoToMarkdown(text: string, citations?: Citations): string {
  const ledger = LEDGER.exec(text)?.[0] ?? '';
  const body = ledger ? text.slice(0, text.length - ledger.length) : text;
  const lines = body.split('\n');
  const code = codeFlags(lines);
  // The front matter is YAML, whatever is in it.
  let first = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) first = end + 1;
  }

  // The targets, in the order they are written, and each one's number among those of its kind.
  const numbers = new Map<string, string>();
  const counts: Record<string, number> = {};
  const define = (id: string) => {
    if (numbers.has(id)) return;
    const kind = id.slice(0, id.indexOf('-'));
    counts[kind] = (counts[kind] ?? 0) + 1;
    numbers.set(id, `${NAMES[kind]} ${counts[kind]}`);
  };
  lines.forEach((line, i) => {
    if (i < first) return;
    const chunk = code[i] ? /^#\|\s*label:\s*((?:fig|tbl|lst)-[\w:.-]*\w)/.exec(line) : null;
    if (chunk) define(chunk[1]!);
    else if (!code[i]) {
      const id = ID.exec(line)?.[1];
      if (id) define(id);
    }
  });

  // The works cited, in order, so that years can be told apart and works numbered.
  const cited: string[] = [];
  if (citations) {
    lines.forEach((line, i) => {
      if (i < first || code[i]) return;
      outsideSpans(line, (plain) => {
        for (const found of plain.matchAll(CITATION)) {
          const keys = found[1]
            ? [found[1]]
            : (parseBracket(found[0])?.map((item) => item.key) ?? []);
          if (!keys.some((key) => XREF.test(key))) cited.push(...keys);
        }
        return plain;
      });
    });
  }
  const context = citations ? makeContext(citations.bib, citations.style, cited) : undefined;
  const cite = (plain: string) =>
    context
      ? plain.replace(CITATION, (found: string, key: string | undefined, at: number) => {
          if (key !== undefined) {
            return XREF.test(key) ? found : (formatNarrative(key, context) ?? found);
          }
          // A bracket that a `(`, `{` or `[` follows is a link or a span.
          if (/^[({[]/.test(plain.slice(at + found.length, at + found.length + 1))) return found;
          const items = parseBracket(found);
          if (!items || items.some((item) => XREF.test(item.key))) return found;
          return formatBracket(items, context) ?? found;
        })
      : plain;
  const label = (id: string) => numbers.get(id) ?? `${NAMES[id.slice(0, id.indexOf('-'))]} ?`;
  /** The prose of a line: references, superscripts and subscripts, outside code spans. */
  const prose = (line: string) =>
    outsideSpans(line, (plain) =>
      cite(plain.replace(INLINE_MATH, (_all, tex: string) => `\`${tex}\``))
        .replace(REFERENCE, (_all, id: string) => label(id))
        .replace(/(?<![\\^])\^([^\s^]+)\^/g, '<sup>$1</sup>')
        .replace(/(?<![\\~])~([^\s~]+)~(?!~)/g, '<sub>$1</sub>'),
    );

  const out: string[] = [];
  // The open divs: whether each one is a callout, which is a level of quote.
  const divs: boolean[] = [];
  const quoted = () => divs.filter(Boolean).length;
  const put = (line: string) => {
    const depth = quoted();
    out.push(depth === 0 ? line : `${'> '.repeat(depth)}${line}`.replace(/ +$/, ''));
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i < first || code[i]) {
      put(line);
      continue;
    }
    const open = OPEN_DIV.exec(line);
    if (open) {
      const attributes = open[2]!;
      const callout = CALLOUT.exec(attributes);
      put('');
      divs.push(callout !== null);
      if (callout) {
        const type = callout[1]!;
        let title = /\btitle="([^"]*)"/.exec(attributes)?.[1] ?? null;
        if (title === null) {
          // A title is the first heading of the callout.
          let next = i + 1;
          while (next < lines.length && lines[next]!.trim() === '') next++;
          const heading = HEADING.exec(lines[next] ?? '');
          if (heading && !code[next]) {
            title = heading[1]!;
            i = next;
          }
        }
        put(`**${prose(title ?? type[0]!.toUpperCase() + type.slice(1))}**`);
        put('');
        while (lines[i + 1]?.trim() === '') i++;
      }
      continue;
    }
    if (CLOSE_DIV.test(line) && divs.length > 0) {
      divs.pop();
      put('');
      continue;
    }
    // A display formula, on a line or across lines: its TeX as a paragraph, numbered.
    const single = /^\s*\$\$(.+?)\$\$\s*(\{[^{}]*\})?\s*$/.exec(line);
    const opening = /^\s*\$\$\s*$/.test(line);
    if (single || opening) {
      let tex = single?.[1] ?? '';
      let attributes = single?.[2] ?? '';
      if (!single) {
        let end = i + 1;
        const parts: string[] = [];
        while (end < lines.length && !/^\s*\$\$\s*(\{[^{}]*\})?\s*$/.test(lines[end]!)) {
          parts.push(lines[end]!.trim());
          end++;
        }
        if (end < lines.length) {
          tex = parts.join(' ');
          attributes = /\{[^{}]*\}/.exec(lines[end]!)?.[0] ?? '';
          i = end;
        } else {
          put(prose(line));
          continue;
        }
      }
      const id = ID.exec(attributes)?.[1];
      const number = id ? numbers.get(id)?.replace(/^\D+/, '') : undefined;
      put(`${tex.trim()}${number ? `    (${number})` : ''}`);
      continue;
    }
    // A table's caption, after its rows.
    const caption = /^:\s+(.*?)\s*(\{[^{}]*\})?\s*$/.exec(line);
    if (caption && /^\s*\|/.test(previousLine(lines, i))) {
      const id = ID.exec(caption[2] ?? '')?.[1];
      put(`${id ? `${label(id)}: ` : ''}${prose(caption[1]!)}`);
      continue;
    }
    // The attributes of a heading, and of a picture or a link, which are no text.
    const stripped = /^#{1,6}\s/.test(line)
      ? line.replace(ATTRIBUTES, '')
      : line.replace(/(\]\([^)]*\))\{[^{}]*\}/g, '$1');
    put(prose(stripped));
  }
  return out.join('\n') + ledger;
}

function previousLine(lines: string[], from: number): string {
  for (let i = from - 1; i >= 0; i--) if (lines[i]!.trim() !== '') return lines[i]!;
  return '';
}

/**
 * The bibliography and the style a document's front matter names, read through the same reader as
 * its pictures (the files beside the document). The paths that couldn't be read are `unread`.
 */
export async function readBibliography(
  text: string,
  options: { images?: (path: string) => Uint8Array | undefined | Promise<Uint8Array | undefined> },
): Promise<{ citations?: Citations; unread: string[] }> {
  const refs = bibliographyRefs(text);
  if (!refs) return { unread: [] };
  const unread: string[] = [];
  const read = async (path: string): Promise<string | undefined> => {
    try {
      const bytes = await options.images?.(path);
      if (bytes) return new TextDecoder().decode(bytes);
    } catch {
      // Told below.
    }
    unread.push(path);
    return undefined;
  };
  const bib: Bibliography = new Map();
  for (const path of refs.files) {
    const file = await read(path);
    if (file) for (const [key, entry] of parseBibliography(path, file)) bib.set(key, entry);
  }
  const csl = refs.csl ? await read(refs.csl) : undefined;
  if (bib.size === 0) return { unread };
  return {
    citations: { bib, style: (csl ? styleOfCsl(csl) : undefined) ?? 'chicago-author-date' },
    unread,
  };
}
