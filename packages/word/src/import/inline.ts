// Inline content as Markdown: runs with their formatting, links, images, note references, and
// Word's revisions and comment ranges as Redlines marks (format §2, §4).
//
// A paragraph's inlines become a flat list of units, each with a state (plain, inserted, deleted,
// a format change); units with one state make one mark; a deletion followed by an insertion by
// the same person is one substitution (import.md, "Mapping Word revisions to Redlines marks").

import type { Ctx, ThreadState } from './context.ts';
import { payload } from './context.ts';
import type { Inline, ImageRun, NoteReference, Revision, Run, RunFormat } from './model.ts';

/** Which text to write: with the marks, as it reads with every change accepted, or as it read. */
export type View = 'marked' | 'newest' | 'original';

type State =
  | { kind: 'plain' }
  | { kind: 'ins'; rev: Revision; move?: string }
  | { kind: 'del'; rev: Revision; move?: string }
  | { kind: 'fmt'; rev: Revision; ops: string };

interface Unit {
  type: 'unit';
  state: State;
  run?: Run;
  /** Finished Markdown, for what isn't a run. */
  md?: string;
}

interface Marker {
  type: 'marker';
  md: string;
}

type Item = Unit | Marker;

/** Formats in the order they nest, outermost first, with their syntax. */
const FLAGS = [
  { name: 'bold', open: '**', close: '**' },
  { name: 'italic', open: '*', close: '*' },
  { name: 'strike', open: '~~', close: '~~' },
  { name: 'sup', open: '<sup>', close: '</sup>' },
  { name: 'sub', open: '<sub>', close: '</sub>' },
] as const;

type Flag = (typeof FLAGS)[number]['name'];

function key(state: State): string {
  switch (state.kind) {
    case 'plain':
      return 'plain';
    case 'ins':
    case 'del':
      return `${state.kind}|${state.rev.author}|${state.rev.at}|${state.move ?? ''}`;
    case 'fmt':
      return `fmt|${state.rev.author}|${state.rev.at}|${state.ops}`;
  }
}

/** Text that is only text: what Markdown would read as syntax is escaped. */
export function escapeText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replace(/[`*_[\]<>~|]/g, (c) => `\\${c}`)
    .replace(/&(?=#?\w+;)/g, '\\&');
}

/** A line of text that would start a block, with its first character escaped. */
export function guardLineStarts(text: string): string {
  return text
    .replace(/^( {0,3})(#{1,6})(?=\s|$)/gm, '$1\\$2')
    .replace(/^( {0,3})([-+])(?=\s|$)/gm, '$1\\$2')
    .replace(/^( {0,3})(\d{1,9})([.)])(?=\s|$)/gm, '$1$2\\$3')
    .replace(/^( {0,3})([-=]{2,})\s*$/gm, (_, a: string, b: string) => `${a}\\${b}`);
}

/** Two or more line breaks in a row, in text that is gone, were a break between paragraphs. */
function paragraphBreaks(text: string): string {
  return text.replace(/(?:\\\n){2,}/g, '\n\n');
}

function codeSpan(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ');
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^[`\s]|[`\s]$/.test(flat) && /\S/.test(flat) ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

function linkTarget(href: string): string {
  return href.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29');
}

function flagsOf(format: RunFormat): Flag[] {
  const flags: Flag[] = [];
  if (format.bold) flags.push('bold');
  if (format.italic) flags.push('italic');
  if (format.strike) flags.push('strike');
  if (format.superscript) flags.push('sup');
  if (format.subscript) flags.push('sub');
  return flags;
}

/** The operations that turn the format a run had into the one it has (format §2.6). */
function formatOps(old: RunFormat, now: RunFormat): string[] {
  const ops: string[] = [];
  const pairs: [string, boolean, boolean][] = [
    ['bold', old.bold, now.bold],
    ['italic', old.italic, now.italic],
    ['strike', old.strike, now.strike],
    ['code', old.code, now.code],
    ['sup', old.superscript, now.superscript],
    ['sub', old.subscript, now.subscript],
  ];
  for (const [name, was, is] of pairs) {
    if (was !== is) ops.push(`${is ? '+' : '-'}${name}`);
  }
  return ops;
}

/** One piece of text with the formats around it. */
interface Piece {
  /** Text that is finished, or code, or white space, or a marker. */
  text: string;
  kind: 'text' | 'space' | 'code' | 'raw' | 'marker';
  flags: Flag[];
}

export class InlineWriter {
  private readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  /** The Markdown of some inlines. */
  render(inlines: Inline[], view: View): string {
    const items = this.flatten(inlines, view, view === 'marked');
    return view === 'marked' ? this.emit(items) : this.text(items);
  }

  /** The text of a paragraph's children as it reads, for names and alt text. */
  plain(inlines: Inline[]): string {
    return this.render(inlines, 'newest');
  }

  private stateOf(run: Run, view: View): State | null {
    if (run.inserted && run.deleted) {
      if (view === 'marked') {
        this.ctx.note(
          'revision',
          'Text that one person added and another deleted is left out: no Markdown mark can hold both.',
        );
      }
      return null;
    }
    const deleted =
      run.deleted ?? (run.moved?.direction === 'from' ? run.moved.revision : undefined);
    const inserted =
      run.inserted ?? (run.moved?.direction === 'to' ? run.moved.revision : undefined);
    const move = run.moved?.name;
    if (view === 'newest') return deleted ? null : { kind: 'plain' };
    if (view === 'original') return inserted && !deleted ? null : { kind: 'plain' };
    if (deleted) return { kind: 'del', rev: deleted, ...(move ? { move } : {}) };
    if (inserted) return { kind: 'ins', rev: inserted, ...(move ? { move } : {}) };
    if (run.formatChange) {
      const ops = formatOps(run.formatChange.old, run.format);
      if (ops.length > 0)
        return { kind: 'fmt', rev: run.formatChange.revision, ops: ops.join(' ') };
    }
    return { kind: 'plain' };
  }

  /** The runs of a format as they read in a view: their old format in the original view. */
  private formatIn(run: Run, view: View): RunFormat {
    return view === 'original' && run.formatChange ? run.formatChange.old : run.format;
  }

  private flatten(inlines: Inline[], view: View, markers: boolean): Item[] {
    const items: Item[] = [];
    for (const inline of inlines) {
      switch (inline.type) {
        case 'run': {
          const state = this.stateOf(inline, view);
          if (!state || inline.text === '') break;
          const run =
            view === 'original' && inline.formatChange
              ? { ...inline, format: this.formatIn(inline, view) }
              : inline;
          items.push({ type: 'unit', state, run });
          for (const name of inline.format.other)
            this.ctx.note('formatting', `Formatting with no Markdown form was dropped: ${name}.`);
          if (inline.format.underline) {
            this.ctx.note('formatting', 'Underlining was dropped: Markdown has no underline.');
          }
          break;
        }
        case 'image': {
          const state = this.trackedState(inline, view);
          if (state) items.push({ type: 'unit', state, md: this.image(inline) });
          break;
        }
        case 'note': {
          const state = this.trackedState(inline, view);
          if (state) items.push({ type: 'unit', state, md: this.noteReference(inline) });
          break;
        }
        case 'link': {
          const inner = this.flatten(inline.children, view, false);
          const keys = new Set(inner.map((item) => (item.type === 'unit' ? key(item.state) : '')));
          if (inline.href === undefined && inline.anchor !== undefined) {
            // A link inside the document: its text stays, the link goes.
            items.push(...this.flatten(inline.children, view, markers));
            break;
          }
          const href = inline.href ?? '';
          if (keys.size === 1) {
            const first = inner[0];
            if (first?.type !== 'unit') break;
            const flat = first.state.kind === 'del' ? 'original' : 'newest';
            const text = this.text(this.flatten(inline.children, flat, false));
            items.push({ type: 'unit', state: first.state, md: `[${text}](${linkTarget(href)})` });
          } else if (keys.size > 1) {
            const text = this.emit(this.flatten(inline.children, view, markers));
            items.push({
              type: 'unit',
              state: { kind: 'plain' },
              md: `[${text}](${linkTarget(href)})`,
            });
          }
          break;
        }
        case 'commentStart':
        case 'commentEnd':
        case 'commentReference': {
          if (!markers) break;
          const md = this.commentMarker(inline.type, inline.id, inline.deleted !== undefined);
          if (md) items.push({ type: 'marker', md });
          break;
        }
        case 'bookmarkStart':
        case 'bookmarkEnd':
          break;
      }
    }
    return items;
  }

  /** The state of an image or a note reference: they have no format, only revisions. */
  private trackedState(inline: ImageRun | NoteReference, view: View): State | null {
    const deleted =
      inline.deleted ?? (inline.moved?.direction === 'from' ? inline.moved.revision : undefined);
    const inserted =
      inline.inserted ?? (inline.moved?.direction === 'to' ? inline.moved.revision : undefined);
    if (inserted && deleted) return null;
    if (view === 'newest') return deleted ? null : { kind: 'plain' };
    if (view === 'original') return inserted ? null : { kind: 'plain' };
    if (deleted) return { kind: 'del', rev: deleted };
    if (inserted) return { kind: 'ins', rev: inserted };
    return { kind: 'plain' };
  }

  private image(image: ImageRun): string {
    if (image.path === '') {
      this.ctx.note('image', 'A linked picture has no file in the document and was left out.');
      return '';
    }
    const name = image.path.replace(/^word\//, '');
    // Markdown has nowhere to show these, and neither does a browser: said, not linked.
    if (/\.(emf|wmf)$/i.test(name)) {
      this.ctx.note(
        'image',
        'A picture in a format Markdown can’t show (EMF or WMF) was left out.',
      );
      return '';
    }
    const bytes = this.ctx.model.media[image.path];
    if (bytes) this.ctx.media[name] = bytes;
    const alt = image.alt.replace(/[[\]\\]/g, (c) => `\\${c}`).replace(/\s+/g, ' ');
    return `![${alt}](${linkTarget(name)})`;
  }

  private noteReference(reference: NoteReference): string {
    const id = `${reference.kind}:${reference.id}`;
    let found = this.ctx.notes.get(id);
    if (!found) {
      found = { label: String(this.ctx.notes.size + 1), kind: reference.kind, id: reference.id };
      this.ctx.notes.set(id, found);
    }
    return `[^${found.label}]`;
  }

  /** A comment's anchor in the text: a range when both its ends are in the body, else a point. */
  private commentMarker(
    type: 'commentStart' | 'commentEnd' | 'commentReference',
    id: number,
    deleted: boolean,
  ): string {
    const thread = this.ctx.threadOfComment.get(id);
    if (!thread || thread.root.id !== id || deleted) return '';
    const ranged = thread.root.anchor.start && thread.root.anchor.end;
    if (type === 'commentStart' && ranged) {
      thread.open = true;
      return `<!--cmt ${this.ctx.threadId(thread)}-->`;
    }
    if (type === 'commentEnd') {
      if (!thread.open) return '';
      thread.open = false;
      return `<!--/${thread.id}-->`;
    }
    if (type === 'commentStart' && !ranged) return `<!--cmt ${this.ctx.threadId(thread)}-->`;
    if (type === 'commentReference' && thread.id === '' && !ranged) {
      return `<!--cmt ${this.ctx.threadId(thread)}-->`;
    }
    return '';
  }

  /** The openers and closers that a paragraph must write for threads open across its edges. */
  openThreads(): ThreadState[] {
    return this.ctx.threads.filter((thread) => thread.open);
  }

  /** Units and markers as text, with the formats around them. */
  text(items: Item[]): string {
    const pieces: Piece[] = [];
    for (const item of items) {
      if (item.type === 'marker') {
        pieces.push({ text: item.md, kind: 'marker', flags: [] });
        continue;
      }
      if (item.md !== undefined) {
        pieces.push({ text: item.md, kind: 'raw', flags: [] });
        continue;
      }
      const run = item.run;
      if (!run) continue;
      const flags = flagsOf(run.format);
      if (run.format.code) {
        const last = pieces.at(-1);
        const same = last?.kind === 'code' && last.flags.join() === flags.join();
        if (same && last) last.text += run.text;
        else pieces.push({ text: run.text, kind: 'code', flags });
        continue;
      }
      const lines = run.text.replace(/\r/g, '').replace(/\t/g, ' ').split('\n');
      lines.forEach((line, index) => {
        if (index > 0) pieces.push({ text: '\\\n', kind: 'raw', flags: [] });
        const found = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
        const lead = found?.[1] ?? '';
        const core = found?.[2] ?? '';
        const trail = found?.[3] ?? '';
        if (core === '') {
          if (line !== '') pieces.push({ text: line, kind: 'space', flags });
          return;
        }
        if (lead) pieces.push({ text: lead, kind: 'space', flags });
        pieces.push({ text: escapeText(core), kind: 'text', flags });
        if (trail) pieces.push({ text: trail, kind: 'space', flags });
      });
    }
    // White space and markers take the formats their neighbours share, so a bold word, a space and
    // a bold word are one bold stretch, and a space at the edge of one is outside it.
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (!piece || (piece.kind !== 'space' && piece.kind !== 'marker')) continue;
      let before = i - 1;
      while (before >= 0 && pieces[before]?.kind === 'marker') before--;
      let after = i + 1;
      while (
        after < pieces.length &&
        (pieces[after]?.kind === 'marker' || pieces[after]?.kind === 'space')
      )
        after++;
      const a = pieces[before];
      const b = pieces[after];
      piece.flags =
        a && b && a.kind !== 'raw' && b.kind !== 'raw'
          ? a.flags.filter((flag) => b.flags.includes(flag))
          : [];
    }
    let out = '';
    let open: Flag[] = [];
    const syntax = (flag: Flag) => FLAGS.find((f) => f.name === flag);
    for (const piece of pieces) {
      const want = FLAGS.map((f) => f.name).filter((name) => piece.flags.includes(name));
      let keep = 0;
      while (keep < open.length && want.includes(open[keep] as Flag)) keep++;
      for (let i = open.length - 1; i >= keep; i--) out += syntax(open[i] as Flag)?.close ?? '';
      open = open.slice(0, keep);
      for (const flag of want) {
        if (!open.includes(flag)) {
          out += syntax(flag)?.open ?? '';
          open.push(flag);
        }
      }
      out += piece.kind === 'code' ? codeSpan(piece.text) : piece.text;
    }
    for (let i = open.length - 1; i >= 0; i--) out += syntax(open[i] as Flag)?.close ?? '';
    return out;
  }

  /** Items as text with a mark around each stretch of one state. */
  private emit(items: Item[]): string {
    interface Group {
      state: State | null;
      key: string;
      items: Item[];
    }
    const groups: Group[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const last = groups.at(-1);
      if (item.type === 'unit') {
        const k = key(item.state);
        if (last && last.key === k) last.items.push(item);
        else groups.push({ state: item.state, key: k, items: [item] });
        continue;
      }
      // A marker stays inside a group when the next unit has the group's state, unless it is a
      // deletion, whose text is a payload.
      const next = items.slice(i + 1).find((other) => other.type === 'unit');
      if (
        last &&
        last.state &&
        last.state.kind !== 'del' &&
        next?.type === 'unit' &&
        key(next.state) === last.key
      ) {
        last.items.push(item);
      } else if (last && last.state === null) last.items.push(item);
      else groups.push({ state: null, key: 'marker', items: [item] });
    }
    let out = '';
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      if (!group) continue;
      const state = group.state;
      if (!state) {
        out += this.text(group.items);
        continue;
      }
      const body = this.text(group.items);
      if (state.kind === 'plain') {
        out += body;
      } else if (state.kind === 'ins') {
        if (body === '') continue;
        const id = this.ctx.mark(state.rev);
        this.ctx.moveEnd(state.move, 'to', id);
        out += `<!--ins ${id}-->${body}<!--/${id}-->`;
      } else if (state.kind === 'del') {
        const next = groups[g + 1];
        const nextState = next?.state;
        if (
          nextState?.kind === 'ins' &&
          !state.move &&
          !nextState.move &&
          this.ctx.people.handle(state.rev.author) === this.ctx.people.handle(nextState.rev.author)
        ) {
          const newText = this.text(next?.items ?? []);
          const id = this.ctx.mark(nextState.rev);
          out += `<!--sub ${id} ${payload(paragraphBreaks(body))}-->${newText}<!--/${id}-->`;
          g++;
          continue;
        }
        if (body === '') continue;
        const id = this.ctx.mark(state.rev);
        this.ctx.moveEnd(state.move, 'from', id);
        out += `<!--del ${id} ${payload(paragraphBreaks(body))}-->`;
      } else {
        const found = /^(\s*)([\s\S]*?)(\s*)$/.exec(body);
        const core = found?.[2] ?? '';
        if (core === '') {
          out += body;
          continue;
        }
        const id = this.ctx.mark(state.rev);
        out += `${found?.[1] ?? ''}<!--fmt ${id} ${state.ops}-->${core}<!--/${id}-->${found?.[3] ?? ''}`;
      }
    }
    return out;
  }
}
