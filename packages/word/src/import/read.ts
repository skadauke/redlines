// Reads a .docx into the block and run model (`model.ts`). It keeps Word's structure and every
// revision where Word put it, and decides nothing about Markdown.
//
// Normalized here, so the mapper never sees it:
//   - an `rPrChange`, `pPrChange` that changes nothing the mapper cares about is dropped (Google
//     Docs writes an empty `rPrChange` on every suggestion);
//   - `mc:AlternateContent` is read through its `Choice` alone (the `Fallback` repeats it);
//   - comment times use `w16cex:dateUtc` or `w16du:dateUtc` before `w:date` (word.md, "Identity,
//     ids and time");
//   - a reply is found by `commentsExtended.xml`, and a reply of a reply goes to the thread's root.

import { ledgerTime } from '../shared/dates.ts';
import type { ReportEntry } from '../shared/report.ts';
import { partText, readParts } from '../shared/zip.ts';
import type { Parts } from '../shared/zip.ts';
import type {
  BookmarkMarker,
  Block,
  Comment,
  CommentThread,
  DocxModel,
  ImageRun,
  Inline,
  ListInfo,
  Note,
  Paragraph,
  ParagraphMark,
  ParagraphProps,
  Person,
  Revision,
  Run,
  RunFormat,
  StyleInfo,
  Table,
  TableCell,
  TableRow,
  Tracked,
} from './model.ts';
import { kid, kids, parseXml, textOf } from './xml.ts';
import type { XmlElement } from './xml.ts';

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

/** The size of a part that is read, so that a damaged or hostile file can't take the app down. */
const MAX_PART = 200 * 1024 * 1024;

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

/** A path inside the zip, from a relationship's target and the folder of the part it belongs to. */
function resolvePath(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out = folder === '' ? [] : folder.split('/');
  for (const step of target.split('/')) {
    if (step === '..') out.pop();
    else if (step !== '.' && step !== '') out.push(step);
  }
  return out.join('/');
}

function relsOf(parts: Parts, partPath: string): Map<string, Relationship> {
  const slash = partPath.lastIndexOf('/');
  const folder = partPath.slice(0, slash + 1);
  const text = partText(parts, `${folder}_rels/${partPath.slice(slash + 1)}.rels`);
  const map = new Map<string, Relationship>();
  if (text === undefined) return map;
  for (const rel of kids(parseXml(text), 'Relationship')) {
    const id = rel.attrs['Id'];
    const target = rel.attrs['Target'];
    if (id === undefined || target === undefined) continue;
    const external = rel.attrs['TargetMode'] === 'External';
    map.set(id, {
      type: rel.attrs['Type'] ?? '',
      target: external ? target : resolvePath(folder.replace(/\/$/, ''), target),
      external,
    });
  }
  return map;
}

/** `val` of an on/off property: absent value means on. */
function isOn(element: XmlElement | undefined): boolean {
  if (!element) return false;
  const value = element.attrs['w:val'];
  return value === undefined || !/^(0|false|off)$/i.test(value);
}

function val(element: XmlElement | undefined): string | undefined {
  return element?.attrs['w:val'];
}

function revisionOf(element: XmlElement): Revision {
  const date = element.attrs['w:date'] ?? '';
  const dateUtc = element.attrs['w16du:dateUtc'];
  const utc = dateUtc === undefined ? '' : ledgerTime(dateUtc);
  const revision: Revision = {
    id: Number(element.attrs['w:id'] ?? 0),
    author: element.attrs['w:author'] ?? '',
    date,
    at: utc || ledgerTime(date),
    utc: utc !== '',
  };
  if (dateUtc !== undefined) revision.dateUtc = dateUtc;
  return revision;
}

const MONO =
  /^(courier|consolas|menlo|monaco|lucida console|source code|fira (code|mono)|jetbrains mono|sf mono|andale mono|dejavu sans mono|liberation mono|roboto mono|cascadia|inconsolata|ubuntu mono)/i;

/** Character properties that have no Markdown form, by element name. */
const OTHER_RUN = new Set([
  'color',
  'sz',
  'highlight',
  'shd',
  'caps',
  'smallCaps',
  'vanish',
  'spacing',
  'position',
  'effect',
  'emboss',
  'imprint',
  'outline',
  'shadow',
  'bdr',
  'fitText',
  'em',
]);

const OTHER_PARAGRAPH = new Set([
  'ind',
  'spacing',
  'shd',
  'pBdr',
  'framePr',
  'tabs',
  'contextualSpacing',
]);

interface StyleDef {
  info: StyleInfo;
  numId?: number;
  level?: number;
  outline?: number;
}

function emptyFormat(): RunFormat {
  return {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
    superscript: false,
    subscript: false,
    code: false,
    other: [],
  };
}

function sameFormat(a: RunFormat, b: RunFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.underline === b.underline &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.code === b.code &&
    a.other.join() === b.other.join()
  );
}

class Reader {
  styles = new Map<string, StyleDef>();
  numbering = new Map<number, Map<number, string>>();
  rels = new Map<string, Relationship>();
  media: Record<string, Uint8Array> = {};
  report: ReportEntry[] = [];
  private moves: { id: string; name: string }[] = [];
  private fields: { out: Inline[]; instruction: string; start: number }[] = [];
  private reported = new Set<string>();

  note(kind: string, message: string): void {
    if (this.reported.has(kind)) return;
    this.reported.add(kind);
    this.report.push({ kind, message });
  }

  // Styles and numbering --------------------------------------------------------------------

  readStyles(root: XmlElement): void {
    for (const style of kids(root, 'w:style')) {
      const id = style.attrs['w:styleId'];
      if (id === undefined) continue;
      const info: StyleInfo = {
        id,
        name: val(kid(style, 'w:name')) ?? id,
        type: style.attrs['w:type'] ?? 'paragraph',
      };
      const basedOn = val(kid(style, 'w:basedOn'));
      if (basedOn !== undefined) info.basedOn = basedOn;
      const def: StyleDef = { info };
      const pPr = kid(style, 'w:pPr');
      const numPr = kid(pPr, 'w:numPr');
      if (numPr) {
        const numId = Number(val(kid(numPr, 'w:numId')));
        if (Number.isFinite(numId)) def.numId = numId;
        const level = Number(val(kid(numPr, 'w:ilvl')));
        if (Number.isFinite(level)) def.level = level;
      }
      const outline = Number(val(kid(pPr, 'w:outlineLvl')));
      if (val(kid(pPr, 'w:outlineLvl')) !== undefined && Number.isFinite(outline)) {
        def.outline = outline;
      }
      this.styles.set(id, def);
    }
  }

  readNumbering(root: XmlElement): void {
    const abstracts = new Map<number, Map<number, string>>();
    for (const abstract of kids(root, 'w:abstractNum')) {
      const levels = new Map<number, string>();
      for (const lvl of kids(abstract, 'w:lvl')) {
        levels.set(Number(lvl.attrs['w:ilvl'] ?? 0), val(kid(lvl, 'w:numFmt')) ?? '');
      }
      abstracts.set(Number(abstract.attrs['w:abstractNumId']), levels);
    }
    for (const num of kids(root, 'w:num')) {
      const levels = abstracts.get(Number(val(kid(num, 'w:abstractNumId'))));
      if (levels) this.numbering.set(Number(num.attrs['w:numId']), levels);
    }
  }

  /** The style, and the styles it is based on. */
  private chain(styleId: string | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let at = styleId;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const def = this.styles.get(at);
      if (!def) break;
      out.push(def);
      at = def.info.basedOn;
    }
    return out;
  }

  // Properties ------------------------------------------------------------------------------

  formatOf(rPr: XmlElement | undefined): RunFormat {
    const format = emptyFormat();
    if (!rPr) return format;
    const other = new Set<string>();
    for (const prop of kids(rPr)) {
      const name = prop.name.startsWith('w:') ? prop.name.slice(2) : '';
      switch (name) {
        case 'b':
          format.bold = isOn(prop);
          break;
        case 'i':
          format.italic = isOn(prop);
          break;
        case 'strike':
        case 'dstrike':
          format.strike = format.strike || isOn(prop);
          break;
        case 'u':
          format.underline = val(prop) !== 'none' && val(prop) !== undefined;
          break;
        case 'vertAlign':
          format.superscript = val(prop) === 'superscript';
          format.subscript = val(prop) === 'subscript';
          break;
        case 'rFonts': {
          const font = prop.attrs['w:ascii'] ?? prop.attrs['w:hAnsi'] ?? '';
          if (MONO.test(font)) format.code = true;
          else if (font !== '') other.add('rFonts');
          break;
        }
        case 'rStyle': {
          const style = this.styles.get(val(prop) ?? '')?.info;
          const label = `${style?.name ?? ''} ${val(prop) ?? ''}`;
          if (/\bcode\b|source ?code|verbatim/i.test(label)) format.code = true;
          if (/^strong\b/i.test(style?.name ?? '')) format.bold = true;
          if (/^emphasis\b/i.test(style?.name ?? '')) format.italic = true;
          break;
        }
        default:
          if (OTHER_RUN.has(name)) other.add(name);
      }
    }
    format.other = [...other].sort();
    return format;
  }

  paragraphProps(pPr: XmlElement | undefined): ParagraphProps {
    const props: ParagraphProps = { other: [] };
    const styleId = val(kid(pPr, 'w:pStyle'));
    const chain = this.chain(styleId);
    if (styleId !== undefined) {
      props.styleId = styleId;
      const name = this.styles.get(styleId)?.info.name;
      if (name !== undefined) props.styleName = name;
    }
    for (const def of chain) {
      const found =
        /^heading ?([1-9])$/i.exec(def.info.name) ?? /^heading([1-9])$/i.exec(def.info.id);
      if (found) {
        props.headingLevel = Number(found[1]);
        break;
      }
    }
    const outline = val(kid(pPr, 'w:outlineLvl'));
    if (props.headingLevel === undefined && outline !== undefined) {
      const level = Number(outline);
      if (level >= 0 && level <= 8) props.headingLevel = level + 1;
    }
    // Numbering: the paragraph's own, else its style's.
    let numId: number | undefined;
    let level: number | undefined;
    const numPr = kid(pPr, 'w:numPr');
    if (numPr) {
      const n = Number(val(kid(numPr, 'w:numId')));
      if (val(kid(numPr, 'w:numId')) !== undefined && Number.isFinite(n)) numId = n;
      const l = Number(val(kid(numPr, 'w:ilvl')));
      if (val(kid(numPr, 'w:ilvl')) !== undefined && Number.isFinite(l)) level = l;
    }
    if (numId === undefined && !numPr) {
      for (const def of chain) {
        if (def.numId !== undefined) {
          numId = def.numId;
          level ??= def.level;
          break;
        }
      }
    }
    if (numId !== undefined && numId !== 0) {
      const format = this.numbering.get(numId)?.get(level ?? 0) ?? '';
      const list: ListInfo = {
        numId,
        level: level ?? 0,
        format,
        ordered: format !== '' && format !== 'bullet' && format !== 'none',
      };
      props.list = list;
    }
    const align = val(kid(pPr, 'w:jc'));
    if (align !== undefined) props.align = align;
    const other = new Set<string>();
    for (const prop of kids(pPr)) {
      const name = prop.name.startsWith('w:') ? prop.name.slice(2) : '';
      if (OTHER_PARAGRAPH.has(name)) other.add(name);
    }
    props.other = [...other].sort();
    return props;
  }

  // Blocks ----------------------------------------------------------------------------------

  blocks(parent: XmlElement | undefined): Block[] {
    const out: Block[] = [];
    for (const child of kids(parent)) {
      switch (child.name) {
        case 'w:p':
          out.push(this.paragraph(child));
          break;
        case 'w:tbl':
          out.push(this.table(child));
          break;
        case 'w:sdt':
          out.push(...this.blocks(kid(child, 'w:sdtContent')));
          break;
        case 'w:ins':
        case 'w:del':
        case 'w:customXml':
          out.push(...this.blocks(child));
          break;
        case 'mc:AlternateContent':
          out.push(...this.blocks(kid(child, 'mc:Choice')));
          break;
        default:
      }
    }
    return out;
  }

  paragraph(p: XmlElement): Paragraph {
    const pPr = kid(p, 'w:pPr');
    const props = this.paragraphProps(pPr);
    const mark: ParagraphMark = {};
    const rPr = kid(pPr, 'w:rPr');
    for (const el of kids(rPr)) {
      if (el.name === 'w:ins') mark.inserted = revisionOf(el);
      else if (el.name === 'w:del') mark.deleted = revisionOf(el);
      else if (el.name === 'w:moveFrom')
        mark.moved = { direction: 'from', revision: revisionOf(el) };
      else if (el.name === 'w:moveTo') mark.moved = { direction: 'to', revision: revisionOf(el) };
    }
    const paragraph: Paragraph = { type: 'paragraph', ...props, mark, children: [] };
    const change = kid(pPr, 'w:pPrChange');
    if (change) {
      const old = this.paragraphProps(kid(change, 'w:pPr'));
      const same =
        old.styleId === props.styleId &&
        old.list?.numId === props.list?.numId &&
        old.list?.level === props.list?.level &&
        old.align === props.align &&
        old.other.join() === props.other.join();
      if (!same) paragraph.propsChange = { revision: revisionOf(change), old };
    }
    this.fields = [];
    this.moves = [];
    this.inlines(p, {}, paragraph.children);
    this.fields = [];
    return paragraph;
  }

  table(tbl: XmlElement): Table {
    const table: Table = { type: 'table', grid: [], rows: [] };
    const grid = kid(tbl, 'w:tblGrid');
    for (const col of kids(grid, 'w:gridCol')) table.grid.push(Number(col.attrs['w:w'] ?? 0));
    const change = kid(kid(tbl, 'w:tblPr'), 'w:tblPrChange') ?? kid(grid, 'w:tblGridChange');
    if (change) table.propsChange = revisionOf(change);
    const rows = (parent: XmlElement): XmlElement[] =>
      kids(parent).flatMap((child) =>
        child.name === 'w:tr'
          ? [child]
          : child.name === 'w:sdt'
            ? rows(kid(child, 'w:sdtContent') ?? child)
            : [],
      );
    for (const tr of rows(tbl)) {
      const trPr = kid(tr, 'w:trPr');
      const row: TableRow = { cells: [], header: isOn(kid(trPr, 'w:tblHeader')) };
      const ins = kid(trPr, 'w:ins');
      const del = kid(trPr, 'w:del');
      if (ins) row.inserted = revisionOf(ins);
      if (del) row.deleted = revisionOf(del);
      const cells = (parent: XmlElement): XmlElement[] =>
        kids(parent).flatMap((child) =>
          child.name === 'w:tc'
            ? [child]
            : child.name === 'w:sdt'
              ? cells(kid(child, 'w:sdtContent') ?? child)
              : [],
        );
      for (const tc of cells(tr)) {
        const tcPr = kid(tc, 'w:tcPr');
        const cell: TableCell = {
          span: Math.max(1, Number(val(kid(tcPr, 'w:gridSpan')) ?? 1) || 1),
          blocks: this.blocks(tc),
        };
        const merge = kid(tcPr, 'w:vMerge');
        if (merge) cell.vMerge = val(merge) === 'restart' ? 'restart' : 'continue';
        const cellIns = kid(tcPr, 'w:cellIns');
        const cellDel = kid(tcPr, 'w:cellDel');
        const cellMerge = kid(tcPr, 'w:cellMerge');
        if (cellIns) cell.inserted = revisionOf(cellIns);
        if (cellDel) cell.deleted = revisionOf(cellDel);
        if (cellMerge) cell.merged = revisionOf(cellMerge);
        row.cells.push(cell);
      }
      table.rows.push(row);
    }
    return table;
  }

  // Inlines ---------------------------------------------------------------------------------

  inlines(parent: XmlElement | undefined, ctx: Tracked, out: Inline[]): void {
    for (const child of kids(parent)) {
      switch (child.name) {
        case 'w:r':
          this.run(child, ctx, out);
          break;
        case 'w:ins':
          this.inlines(child, { ...ctx, inserted: revisionOf(child) }, out);
          break;
        case 'w:del':
          this.inlines(child, { ...ctx, deleted: revisionOf(child) }, out);
          break;
        case 'w:moveFrom':
        case 'w:moveTo': {
          const name = this.moves[this.moves.length - 1]?.name;
          const moved: NonNullable<Tracked['moved']> = {
            direction: child.name === 'w:moveFrom' ? 'from' : 'to',
            revision: revisionOf(child),
          };
          if (name !== undefined) moved.name = name;
          this.inlines(child, { ...ctx, moved }, out);
          break;
        }
        case 'w:moveFromRangeStart':
        case 'w:moveToRangeStart':
          this.moves.push({ id: child.attrs['w:id'] ?? '', name: child.attrs['w:name'] ?? '' });
          break;
        case 'w:moveFromRangeEnd':
        case 'w:moveToRangeEnd': {
          const index = this.moves.map((move) => move.id).lastIndexOf(child.attrs['w:id'] ?? '');
          if (index >= 0) this.moves.splice(index, 1);
          break;
        }
        case 'w:hyperlink':
          this.link(child, ctx, out);
          break;
        case 'w:fldSimple': {
          const address = hyperlinkAddress(child.attrs['w:instr'] ?? '');
          if (address !== undefined) {
            const link: Inline = { type: 'link', href: address, children: [] };
            this.inlines(child, ctx, link.children);
            out.push(link);
          } else this.inlines(child, ctx, out);
          break;
        }
        case 'w:commentRangeStart':
          out.push({ type: 'commentStart', id: Number(child.attrs['w:id']) });
          break;
        case 'w:commentRangeEnd':
          out.push({ type: 'commentEnd', id: Number(child.attrs['w:id']) });
          break;
        case 'w:bookmarkStart':
        case 'w:bookmarkEnd': {
          const marker: BookmarkMarker = {
            type: child.name === 'w:bookmarkStart' ? 'bookmarkStart' : 'bookmarkEnd',
            name: child.attrs['w:name'] ?? '',
            id: Number(child.attrs['w:id'] ?? 0),
          };
          out.push(marker);
          break;
        }
        case 'w:sdt':
          this.inlines(kid(child, 'w:sdtContent'), ctx, out);
          break;
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:dir':
        case 'w:bdo':
          this.inlines(child, ctx, out);
          break;
        case 'mc:AlternateContent':
          this.inlines(kid(child, 'mc:Choice'), ctx, out);
          break;
        case 'm:oMath':
        case 'm:oMathPara': {
          this.note('equation', 'An equation was flattened to its text.');
          out.push(this.plainRun(textOf(child), ctx));
          break;
        }
        default:
      }
    }
  }

  private plainRun(text: string, ctx: Tracked): Run {
    return { type: 'run', text, format: emptyFormat(), ...ctx };
  }

  private link(element: XmlElement, ctx: Tracked, out: Inline[]): void {
    const link: Inline = { type: 'link', children: [] };
    const id = element.attrs['r:id'];
    const rel = id === undefined ? undefined : this.rels.get(id);
    if (rel) link.href = rel.target;
    const anchor = element.attrs['w:anchor'];
    if (anchor !== undefined) link.anchor = anchor;
    this.inlines(element, ctx, link.children);
    out.push(link);
  }

  private run(r: XmlElement, ctx: Tracked, out: Inline[]): void {
    const rPr = kid(r, 'w:rPr');
    const format = this.formatOf(rPr);
    let text = '';
    const flush = (): void => {
      if (text === '') return;
      const run: Run = { type: 'run', text, format, ...ctx };
      const style = val(kid(rPr, 'w:rStyle'));
      if (style !== undefined) run.style = style;
      const change = kid(rPr, 'w:rPrChange');
      if (change) {
        const old = this.formatOf(kid(change, 'w:rPr'));
        if (!sameFormat(old, format)) run.formatChange = { revision: revisionOf(change), old };
      }
      out.push(run);
      text = '';
    };
    const content = (el: XmlElement): void => {
      for (const part of kids(el)) {
        switch (part.name) {
          case 'w:t':
          case 'w:delText':
            text += textOf(part);
            break;
          case 'w:tab':
            text += '\t';
            break;
          case 'w:br':
            if (!part.attrs['w:type'] || part.attrs['w:type'] === 'textWrapping') text += '\n';
            break;
          case 'w:cr':
            text += '\n';
            break;
          case 'w:noBreakHyphen':
            text += '-';
            break;
          case 'w:instrText':
            this.fieldInstruction(out, textOf(part));
            break;
          case 'w:fldChar':
            flush();
            this.fieldChar(out, part.attrs['w:fldCharType'] ?? '');
            break;
          case 'w:drawing':
          case 'w:pict':
          case 'w:object':
            flush();
            this.drawing(part, ctx, out);
            break;
          case 'mc:AlternateContent': {
            const choice = kid(part, 'mc:Choice');
            if (choice) content(choice);
            break;
          }
          case 'w:commentReference': {
            flush();
            const marker: Inline = { type: 'commentReference', id: Number(part.attrs['w:id']) };
            if (ctx.inserted) marker.inserted = ctx.inserted;
            if (ctx.deleted) marker.deleted = ctx.deleted;
            out.push(marker);
            break;
          }
          case 'w:footnoteReference':
          case 'w:endnoteReference': {
            flush();
            out.push({
              type: 'note',
              kind: part.name === 'w:footnoteReference' ? 'footnote' : 'endnote',
              id: Number(part.attrs['w:id']),
              ...ctx,
            });
            break;
          }
          default:
        }
      }
    };
    content(r);
    flush();
  }

  private drawing(element: XmlElement, ctx: Tracked, out: Inline[]): void {
    let found = false;
    const walk = (el: XmlElement): void => {
      if (el.name === 'a:blip' || el.name === 'v:imagedata') {
        const id = el.attrs['r:embed'] ?? el.attrs['r:id'] ?? el.attrs['r:link'];
        const rel = id === undefined ? undefined : this.rels.get(id);
        const image: ImageRun = {
          type: 'image',
          path: rel && !rel.external ? rel.target : '',
          alt: '',
          width: 0,
          height: 0,
          ...ctx,
        };
        const docPr = findFirst(element, 'wp:docPr');
        if (docPr) image.alt = docPr.attrs['descr'] || docPr.attrs['title'] || '';
        const extent = findFirst(element, 'wp:extent');
        if (extent) {
          image.width = Number(extent.attrs['cx'] ?? 0) || 0;
          image.height = Number(extent.attrs['cy'] ?? 0) || 0;
        }
        out.push(image);
        found = true;
        return;
      }
      if (el.name === 'mc:Fallback') return;
      for (const child of kids(el)) walk(child);
    };
    walk(element);
    if (found) return;
    const box = findFirst(element, 'w:txbxContent');
    if (box) {
      this.note('text box', 'A text box was flattened to its text.');
      const text = this.blocks(box)
        .filter((block): block is Paragraph => block.type === 'paragraph')
        .map((p) => inlineText(p.children))
        .join(' ');
      if (text !== '') out.push(this.plainRun(text, ctx));
    } else this.note('drawing', 'A drawing or shape that is not a picture was dropped.');
  }

  // Fields: a HYPERLINK field's result is wrapped in a link.
  private fieldChar(out: Inline[], type: string): void {
    if (type === 'begin') this.fields.push({ out, instruction: '', start: -1 });
    else if (type === 'separate') {
      const field = this.fields[this.fields.length - 1];
      if (field && field.out === out) field.start = out.length;
    } else if (type === 'end') {
      const field = this.fields.pop();
      if (!field || field.out !== out || field.start < 0) return;
      const address = hyperlinkAddress(field.instruction);
      if (address === undefined) return;
      const result = out.splice(field.start);
      out.push({ type: 'link', href: address, children: result });
    }
  }

  private fieldInstruction(out: Inline[], text: string): void {
    const field = this.fields[this.fields.length - 1];
    if (field && field.out === out) field.instruction += text;
  }
}

function hyperlinkAddress(instruction: string): string | undefined {
  const found = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instruction);
  return found?.[1];
}

function findFirst(element: XmlElement, name: string): XmlElement | undefined {
  if (element.name === name) return element;
  for (const child of kids(element)) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return undefined;
}

/** The text of inlines that are not deleted. */
function inlineText(inlines: Inline[]): string {
  let out = '';
  for (const inline of inlines) {
    if (inline.type === 'run' && !inline.deleted && inline.moved?.direction !== 'from') {
      out += inline.text;
    } else if (inline.type === 'link') out += inlineText(inline.children);
  }
  return out;
}

function blocksText(blocks: Block[]): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph') texts.push(inlineText(block.children));
    else {
      for (const row of block.rows) {
        for (const cell of row.cells) texts.push(blocksText(cell.blocks));
      }
    }
  }
  return texts.join('\n\n');
}

function eachInline(blocks: Block[], visit: (inline: Inline) => void): void {
  const walk = (inlines: Inline[]): void => {
    for (const inline of inlines) {
      visit(inline);
      if (inline.type === 'link') walk(inline.children);
    }
  };
  for (const block of blocks) {
    if (block.type === 'paragraph') walk(block.children);
    else {
      for (const row of block.rows) {
        for (const cell of row.cells) eachInline(cell.blocks, visit);
      }
    }
  }
}

function root(parts: Parts, path: string | undefined): XmlElement | undefined {
  if (path === undefined) return undefined;
  const text = partText(parts, path);
  if (text === undefined) return undefined;
  if (text.length > MAX_PART) throw new Error(`The part ${path} is too large to read.`);
  return parseXml(text);
}

/**
 * Reads a .docx. Throws when the bytes aren't a Word file at all (not a zip, or no main
 * document); everything else the file holds that this reader doesn't understand is dropped and
 * listed in `report`.
 */
export function readDocx(bytes: Uint8Array): DocxModel {
  let parts: Parts;
  try {
    parts = readParts(bytes);
  } catch {
    throw new Error('This is not a Word (.docx) file: it is not a zip.');
  }
  return readDocxParts(parts);
}

/** `readDocx` for a file that is already unzipped. */
export function readDocxParts(parts: Parts): DocxModel {
  // The main part, from the package's own relationships.
  const packageRels = relsOf(parts, '.rels');
  let mainPath = 'word/document.xml';
  for (const rel of packageRels.values()) {
    if (rel.type === `${REL_BASE}officeDocument` && !rel.external) mainPath = rel.target;
  }
  const slash = mainPath.lastIndexOf('/');
  const folder = mainPath.slice(0, slash + 1);
  const documentRoot = root(parts, parts[mainPath] ? mainPath : undefined);
  if (!documentRoot)
    throw new Error('This is not a Word (.docx) file: it has no word/document.xml.');

  const reader = new Reader();
  reader.rels = relsOf(parts, mainPath);
  const companion = (suffix: string, fallback: string): string | undefined => {
    for (const rel of reader.rels.values()) {
      if (!rel.external && rel.type.endsWith(`/${suffix}`) && parts[rel.target]) return rel.target;
    }
    return parts[`${folder}${fallback}`] ? `${folder}${fallback}` : undefined;
  };

  const stylesRoot = root(parts, companion('styles', 'styles.xml'));
  if (stylesRoot) reader.readStyles(stylesRoot);
  const numberingRoot = root(parts, companion('numbering', 'numbering.xml'));
  if (numberingRoot) reader.readNumbering(numberingRoot);
  const settingsRoot = root(parts, companion('settings', 'settings.xml'));

  const model: DocxModel = {
    blocks: reader.blocks(kid(documentRoot, 'w:body')),
    comments: [],
    threads: [],
    people: [],
    footnotes: [],
    endnotes: [],
    styles: Object.fromEntries([...reader.styles].map(([id, def]) => [id, def.info])),
    trackRevisions: isOn(kid(settingsRoot, 'w:trackRevisions')),
    media: {},
    report: reader.report,
  };

  for (const rel of reader.rels.values()) {
    if (!rel.external && rel.type.endsWith('/image') && parts[rel.target]) {
      model.media[rel.target] = parts[rel.target] as Uint8Array;
    }
  }

  // Notes.
  for (const [kind, list] of [
    ['footnotes', model.footnotes],
    ['endnotes', model.endnotes],
  ] as const) {
    const notes = root(parts, companion(kind, `${kind}.xml`));
    for (const note of kids(notes, kind === 'footnotes' ? 'w:footnote' : 'w:endnote')) {
      const type = note.attrs['w:type'];
      if (type !== undefined && type !== 'normal') continue;
      const entry: Note = { id: Number(note.attrs['w:id']), blocks: reader.blocks(note) };
      list.push(entry);
    }
  }

  // Comments.
  const commentsRoot = root(parts, companion('comments', 'comments.xml'));
  const extended = new Map<string, { parent?: string; done: boolean }>();
  for (const el of kids(root(parts, companion('commentsExtended', 'commentsExtended.xml')))) {
    const paraId = el.attrs['w15:paraId'];
    if (paraId === undefined) continue;
    const entry: { parent?: string; done: boolean } = { done: isOnAttr(el.attrs['w15:done']) };
    const parent = el.attrs['w15:paraIdParent'];
    if (parent !== undefined) entry.parent = parent;
    extended.set(paraId, entry);
  }
  const durable = new Map<string, string>();
  for (const el of kids(root(parts, companion('commentsIds', 'commentsIds.xml')))) {
    const paraId = el.attrs['w16cid:paraId'];
    const id = el.attrs['w16cid:durableId'];
    if (paraId !== undefined && id !== undefined) durable.set(paraId, id);
  }
  const utcOf = new Map<string, string>();
  for (const el of kids(root(parts, companion('commentsExtensible', 'commentsExtensible.xml')))) {
    const id = el.attrs['w16cex:durableId'];
    const utc = el.attrs['w16cex:dateUtc'];
    if (id !== undefined && utc !== undefined) utcOf.set(id, utc);
  }
  const paraIds: string[][] = [];
  for (const el of kids(commentsRoot, 'w:comment')) {
    const own = kids(el, 'w:p')
      .map((p) => p.attrs['w14:paraId'])
      .filter((id): id is string => id !== undefined);
    paraIds.push(own);
    const blocks = reader.blocks(el);
    const last = own[own.length - 1];
    const comment: Comment = {
      id: Number(el.attrs['w:id']),
      author: el.attrs['w:author'] ?? '',
      initials: el.attrs['w:initials'] ?? '',
      date: el.attrs['w:date'] ?? '',
      at: '',
      utc: false,
      blocks,
      text: blocksText(blocks),
      done: false,
      anchor: { start: false, end: false, reference: false },
    };
    if (last !== undefined) comment.paraId = last;
    const durableId = [...own]
      .reverse()
      .map((id) => durable.get(id))
      .find((id) => id !== undefined);
    if (durableId !== undefined) comment.durableId = durableId;
    const dateUtc =
      (durableId === undefined ? undefined : utcOf.get(durableId)) ?? el.attrs['w16du:dateUtc'];
    if (dateUtc !== undefined) comment.dateUtc = dateUtc;
    const utc = dateUtc === undefined ? '' : ledgerTime(dateUtc);
    comment.utc = utc !== '';
    comment.at = utc || ledgerTime(comment.date);
    model.comments.push(comment);
  }
  // Threads, from `commentsExtended.xml`.
  const byPara = new Map<string, Comment>();
  model.comments.forEach((comment, i) => {
    for (const id of paraIds[i] ?? []) byPara.set(id, comment);
  });
  model.comments.forEach((comment, i) => {
    const entry = (paraIds[i] ?? []).map((id) => extended.get(id)).find((found) => found);
    if (!entry) return;
    comment.done = entry.done;
    const parent = entry.parent === undefined ? undefined : byPara.get(entry.parent);
    if (parent && parent !== comment) comment.parentId = parent.id;
  });
  const byId = new Map(model.comments.map((comment) => [comment.id, comment]));
  const rootOf = (comment: Comment): Comment => {
    let at = comment;
    const seen = new Set<number>();
    while (at.parentId !== undefined && !seen.has(at.id)) {
      seen.add(at.id);
      const up = byId.get(at.parentId);
      if (!up) break;
      at = up;
    }
    return at;
  };
  const threads = new Map<Comment, CommentThread>();
  for (const comment of model.comments) {
    if (rootOf(comment) === comment) {
      const thread: CommentThread = { root: comment, replies: [], resolved: comment.done };
      threads.set(comment, thread);
      model.threads.push(thread);
    }
  }
  for (const comment of model.comments) {
    const top = rootOf(comment);
    if (top !== comment) threads.get(top)?.replies.push(comment);
  }
  // What the body holds for each comment.
  eachInline(model.blocks, (inline) => {
    if (
      inline.type === 'commentStart' ||
      inline.type === 'commentEnd' ||
      inline.type === 'commentReference'
    ) {
      const comment = byId.get(inline.id);
      if (!comment) return;
      if (inline.type === 'commentStart') comment.anchor.start = true;
      else if (inline.type === 'commentEnd') comment.anchor.end = true;
      else comment.anchor.reference = true;
    }
  });

  // People.
  for (const el of kids(root(parts, companion('people', 'people.xml')), 'w15:person')) {
    const name = el.attrs['w15:author'];
    if (name === undefined) continue;
    const person: Person = { name };
    const presence = kid(el, 'w15:presenceInfo');
    if (presence?.attrs['w15:providerId'] !== undefined) {
      person.providerId = presence.attrs['w15:providerId'];
    }
    if (presence?.attrs['w15:userId'] !== undefined) person.userId = presence.attrs['w15:userId'];
    model.people.push(person);
  }

  const source = partText(parts, 'customXml/redlines-source.xml');
  if (source !== undefined) model.sourcePart = source;
  return model;
}

function isOnAttr(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|on)$/i.test(value);
}
