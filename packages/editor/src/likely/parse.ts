// A far jump in a long document draws at once, from a likely parse (design, Performance). The
// parser CodeMirror runs reads a document from its start, and the viewport can't be styled before
// it gets there: a jump to the middle of 5 MB shows plain text for seconds. Here, when the viewport
// lands far past what the parse has reached, the parse starts at the nearest place above it where
// Markdown starts fresh (`scan.ts`), with the document's link definitions in front of it, and
// skips the text before (`ParseContext.skipUntilInView`, which CodeMirror itself restarts from
// when the viewport comes back to it). The end of the document is exact; a scroll up parses from an
// earlier place. When the viewport has rested, the parse is made again from the start in idle time
// (CodeMirror's own, slice by slice), and the likely tree stays on the screen until the exact one
// reaches the viewport. What the two draw differently is drawn again then.
//
// This leans on three things CodeMirror keeps to itself, which `likely.test.ts` pins to the
// version in the lockfile: a parser's `createParse` is replaced by one that may give ranges, the
// context's `parse` and `treeLen` are set, and an empty transaction wakes its parse worker.

import { Language, ParseContext } from '@codemirror/language';
import {
  StateField,
  type StateEffect,
  type Extension,
  type Text,
  type ChangeSet,
} from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { Tree, type Input, type Parser, type PartialParse, type TreeFragment } from '@lezer/common';
import { restartBefore, scan, type Scan, type Span } from './scan.ts';

/** A document shorter than this is parsed from its start whatever the viewport: it takes no time. */
export const LIKELY_FROM = 300_000;
/** How far past what is parsed the viewport lands before the parse starts nearer to it, in characters. */
const REACH = 150_000;
/** How far above the viewport the likely parse starts, so that a short scroll up needs no new one. */
const LEAD = 30_000;
/** How long the viewport rests before the exact parse is made again from the start, in ms. */
const REST_MS = 1200;
/** How long the first slice of the likely parse may take, in ms. */
const DRAW_MS = 80;

/** The scan of a document, made when it is first needed, and carried through the edits after it. */
class Scanned {
  private scanned: Scan | null;
  private pending: ChangeSet | null = null;
  private composed = 0;

  readonly doc: Text;

  constructor(doc: Text, scanned: Scan | null = null) {
    this.doc = doc;
    this.scanned = scanned;
  }

  /** The scan of `doc`: what it found, its places moved through the edits since. */
  get(): Scan {
    if (!this.scanned) this.scanned = scan(this.doc);
    return this.scanned;
  }

  /** The scan of the document after `changes`, made only when asked for, from this one if it exists. */
  after(changes: ChangeSet, before: Text, doc: Text): Scanned {
    if (!this.scanned) return new Scanned(doc);
    // An edit across a line break may have made or ended a block, a fence or a blank: scanned again
    // when it is next needed.
    let breaks = false;
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (inserted.lines > 1 || before.lineAt(fromA).number !== before.lineAt(toA).number)
        breaks = true;
    });
    if (breaks) return new Scanned(doc);
    const next = new Scanned(doc, this.scanned);
    next.pending = this.pending ? this.pending.compose(changes) : changes;
    next.composed = this.composed + 1;
    // A long run of edits is carried through now and then, not all at once.
    if (next.composed > 100) next.current();
    return next;
  }

  /** The scan with the edits applied. */
  current(): Scan {
    const scanned = this.get();
    if (this.pending) {
      const changes = this.pending;
      this.pending = null;
      this.composed = 0;
      // A line's start stays before what is typed at it.
      const map = (pos: number) => changes.mapPos(pos, -1);
      this.scanned = {
        restarts: scanned.restarts.map(map),
        refs: scanned.refs
          .map((ref) => ({ from: changes.mapPos(ref.from, 1), to: changes.mapPos(ref.to, -1) }))
          .filter((ref) => ref.from < ref.to),
      };
    }
    return this.scanned!;
  }
}

/** What the parse context keeps that its types don't show: what this file sets. */
interface Inside {
  skipped: Span[];
  tempSkipped: Span[];
  treeLen: number;
  parse: PartialParse | null;
  work(until: () => boolean, upto: number): boolean;
  takeTree(): void;
}

/** The context's parts that the likely parse changes. */
const inside = (cx: ParseContext): Inside => cx as unknown as Inside;

/** Lets go of the parse that is going on, and of what it was to cut from the fragments. */
function dropParse(cx: ParseContext): void {
  inside(cx).parse = null;
  inside(cx).tempSkipped = [];
}

/** What one editor's likely parsing keeps. */
interface Shared {
  /** The text before this place is skipped (the likely parse), or 0. */
  headEnd: number;
  /** The exact parse is running again from the start: no likely one is made until the next jump. */
  exact: boolean;
}

/** How far the fragments reach without a gap from the start of the document. */
function reachOf(fragments: readonly TreeFragment[]): number {
  let reach = 0;
  for (const fragment of fragments) {
    if (fragment.from > reach) break;
    reach = Math.max(reach, fragment.to);
  }
  return reach;
}

/** The ranges to parse for a likely parse from `restart`: the definitions, then the document from the blank line before. */
function rangesFor(doc: Text, scanned: Scan, restart: number): { from: number; to: number }[] {
  // The blank line before the restart, so that nothing from a definition runs into it.
  const before = doc.lineAt(Math.max(0, restart - 1));
  const from = before.to < restart ? before.from : restart;
  const ranges: Span[] = [];
  for (const ref of scanned.refs) {
    if (ref.to >= from) break;
    // The line and its break, adjacent ones joined.
    const to = Math.min(ref.to + 1, from);
    const last = ranges[ranges.length - 1];
    if (last && last.to === ref.from) last.to = to;
    else ranges.push({ from: ref.from, to });
  }
  ranges.push({ from, to: doc.length });
  return ranges;
}

/**
 * A parse of ranges, whose tree begins at the first range's start: the tree it gives is moved to
 * the start of the document, with its nodes where the text has them, as a parse of the whole is.
 */
class Placed implements PartialParse {
  private readonly inner: PartialParse;
  private readonly offset: number;

  constructor(inner: PartialParse, offset: number) {
    this.inner = inner;
    this.offset = offset;
  }

  get parsedPos(): number {
    return this.inner.parsedPos;
  }

  get stoppedAt(): number | null {
    return this.inner.stoppedAt;
  }

  stopAt(pos: number): void {
    this.inner.stopAt(pos);
  }

  advance(): Tree | null {
    const tree = this.inner.advance();
    if (!tree) return null;
    const { offset } = this;
    return new Tree(
      tree.type,
      tree.children,
      tree.positions.map((pos) => pos + offset),
      tree.length + offset,
      (tree as unknown as { propValues?: [number, unknown][] }).propValues,
    );
  }
}

/**
 * Makes the parser of `parser` parse from a nearer place when the viewport is far from what is
 * parsed, and returns the extension that keeps the scan, and parses again from the start when the
 * viewport rests. A document shorter than `LIKELY_FROM` is parsed as it was.
 */
export function likelyParsing(parser: Parser, restMs = REST_MS): Extension {
  const shared: Shared = { headEnd: 0, exact: false };
  const original = parser.createParse.bind(parser);

  const scans = StateField.define<Scanned>({
    create: (state) => new Scanned(state.doc),
    update: (value, tr) =>
      tr.docChanged ? value.after(tr.changes, tr.startState.doc, tr.newDoc) : value,
  });

  parser.createParse = (
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse => {
    const cx = ParseContext.get();
    const state = cx?.state;
    if (!cx || !state || state.doc.length < LIKELY_FROM || ranges.length !== 1) {
      return original(input, fragments, ranges);
    }
    const scanned = state.field(scans, false);
    if (!scanned) return original(input, fragments, ranges);
    const doc = state.doc;
    const head = inside(cx).skipped.find((span) => span.from === 0);
    let restart: number | null = null;
    if (head) {
      restart = head.to;
    } else if (
      !shared.exact &&
      cx.viewport.from - Math.max(inside(cx).treeLen, reachOf(fragments)) > REACH
    ) {
      restart = restartBefore(scanned.current().restarts, cx.viewport.from - LEAD);
    }
    if (restart === null || restart <= 0) return original(input, fragments, ranges);
    if (!head) cx.skipUntilInView(0, restart);
    // The tree is not one of the head, which a later parse must not take for parsed: its fragments
    // are cut there once the parse is taken, as CodeMirror does for what a parser skipped.
    inside(cx).tempSkipped.push({ from: 0, to: restart });
    shared.headEnd = restart;
    const parts = rangesFor(doc, scanned.current(), restart);
    return new Placed(original(input, fragments, parts), parts[0]!.from);
  };

  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;

      readonly view: EditorView;
      drawing = false;
      destroyed = false;

      constructor(view: EditorView) {
        this.view = view;
      }

      update(update: ViewUpdate): void {
        if (update.state.doc.length < LIKELY_FROM) return;
        if (!update.viewportChanged && !update.docChanged) return;
        const cx = contextOf(this.view);
        if (!cx) return;
        const { from } = this.view.viewport;
        if (update.docChanged) shared.headEnd = update.changes.mapPos(shared.headEnd, 1);
        if (shared.headEnd > 0 && from < shared.headEnd) {
          // The viewport is above where the likely parse starts: it starts nearer again, or, near
          // the start, parses from it. The tree on the screen stays until the new one reaches it.
          shared.headEnd = 0;
          inside(cx).skipped = inside(cx).skipped.filter((span) => span.from !== 0);
          dropParse(cx);
          inside(cx).treeLen = 0;
        } else if (update.viewportChanged) {
          const reach = Math.max(inside(cx).treeLen, inside(cx).parse?.parsedPos ?? 0);
          if (from - reach > REACH) {
            // A jump past where the parse is: it begins nearer to the viewport.
            shared.exact = false;
            shared.headEnd = 0;
            inside(cx).skipped = inside(cx).skipped.filter((span) => span.from !== 0);
            dropParse(cx);
          }
        }
        if (
          update.viewportChanged &&
          !inside(cx).parse &&
          inside(cx).treeLen < this.view.viewport.to
        )
          this.draw();
        if (update.viewportChanged) this.rest();
      }

      /**
       * Parses to the viewport now, in a slice of its own, and puts the tree on the screen, where
       * CodeMirror's worker would begin after its pause of a few hundred milliseconds.
       */
      draw(): void {
        if (this.drawing) return;
        this.drawing = true;
        queueMicrotask(() => {
          this.drawing = false;
          const cx = contextOf(this.view);
          const field = (Language as unknown as { state?: StateField<object> }).state;
          if (!cx || !field || this.destroyed) return;
          const { to } = this.view.viewport;
          if (inside(cx).treeLen >= to) return;
          const end = Date.now() + DRAW_MS;
          inside(cx).work(() => Date.now() > end, to);
          inside(cx).takeTree();
          const State = this.view.state.field(field).constructor as new (
            context: ParseContext,
          ) => object;
          this.view.dispatch({
            effects: (
              Language as unknown as { setState: { of(value: object): StateEffect<unknown> } }
            ).setState.of(new State(cx)),
          });
        });
      }

      /** After a rest, the exact parse is made from the start, in the idle time CodeMirror gives it. */
      rest(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const cx = contextOf(this.view);
          if (!cx || shared.headEnd === 0) return;
          shared.exact = true;
          shared.headEnd = 0;
          inside(cx).skipped = inside(cx).skipped.filter((span) => span.from !== 0);
          dropParse(cx);
          inside(cx).treeLen = 0;
          // Wakes the parse worker.
          this.view.dispatch({});
        }, restMs);
      }

      destroy(): void {
        this.destroyed = true;
        clearTimeout(this.timer);
      }
    },
  );
  return [scans, plugin];
}

/** The parse context of the view's state, which the language keeps in a field of its own. */
function contextOf(view: EditorView): ParseContext | null {
  const field = (Language as unknown as { state?: StateField<{ context: ParseContext }> }).state;
  const value = field ? view.state.field(field, false) : undefined;
  const context = value?.context;
  return context && typeof context.skipUntilInView === 'function' ? context : null;
}
