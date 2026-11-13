// Formatting commands (spec: Menus): bold, italic, code, strikethrough, subscript, superscript,
// links and clearing for text, and the type of a paragraph, its lists, and the table, rule and code
// block that start one.
// They are commands of the registry, which binds their keys and draws the Format and Paragraph
// menus; none has a button. With Track Changes on a format change is a tracked `fmt` mark, with it
// off the syntax is written directly, and what a block adds is an insertion like typing.

import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { ChangeSet, type EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { EditorView } from '@codemirror/view';
import {
  type Author,
  boxChange,
  calloutMenuEffect,
  calloutName,
  type CalloutMenuRequest,
  checkBoxEffect,
  type Editor,
  markupViewFacet,
  parsedField,
  pastHidden,
  rectOf,
  selectedCells,
  type EditorCommand,
  indentItems,
  selectionInTable,
  setViewModeEffect,
  trackedEditAnnotation,
  trackingField,
  viewModeField,
} from '@redlines/editor';
import {
  type BlockType,
  EditError,
  GITHUB_TYPES,
  applyChanges,
  type FormatOp,
  idsIn,
  type InlineFormat,
  newId,
  type Person,
  type Range,
  type TextChange,
  trackedFormat,
  trackedFormatRanges,
  untrackedFormat,
} from '@redlines/format';
import type { Plugin } from '@redlines/plugin-api';
import { calloutMenuTheme, closeCalloutMenu, openCalloutMenu } from './callout-menu.ts';
import { closeLinkPopover, linkTheme, openLinkPopover } from './link-popover.ts';

export interface FormattingOptions {
  /** Who formats. Read at each command, so a change of name in Preferences shows. */
  author: Author;
  /** Shows a one-line message for what can't be done. Nothing is changed then. */
  notice(message: string): void;
}

const RAW_READ_ONLY =
  'Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.';
/** Said where the preview draws a pair of subscript or superscript tags that the format doesn't
 * read, as one that crosses emphasis: no change could be made, and none is silent (#310). */
const TAGS_NOT_A_PAIR =
  "These <sub> or <sup> tags can't be changed here: they are not a pair that Redlines reads, as when they cross other formatting. Edit them in Raw.";
const ALREADY_CODE = 'This is already a code block.';
const MARKS_IN_CODE =
  'Accept or reject the changes in these lines first, then make them a code block.';
const MARKER_ONLY =
  'The selection is only the marker of a change. Select some of the text to format it.';
const NOT_IN_ITEM = (what: string) =>
  `A list item can't become ${what}. Take it out of the list first.`;
const WRITE_ITEM = 'Write the item first.';
// What a task box says when it can't change, for a click and for Check Item alike.
const CHANGE_IN_WAY = 'A pending change in this item is in the way. Accept or reject it first.';
const BOX_STUCK = "This box can't be changed here. Turn off Track Changes to change it.";
const NOT_CHECKED = "The box of this item can't be changed here.";
const NO_BOX = 'Check Item works on a task list item. Put the caret in one, or select some.';
/** The most items one format change takes (format §2.6: "Change up to six items at a time."); a
 * longer stretch of items is checked by sixes, as one change. */
const CHECK_AT_A_TIME = 6;
const NO_CODE_IN_CONTAINER = "A code block can't be made inside a list or a quote yet.";
/** What Alert writes: the type line, and a body whose text is selected, so that typing writes it
 * (a tracked insertion can't end with an empty quote line, which would take the block after it). */
const ALERT = '> [!NOTE]\n> Text';
const ALERT_BODY = 'Text';
const NO_TRACKED_HEADING_CODE =
  "A heading can't become a code block while Track Changes is on. Make it body text first.";

// What the syntax tree calls them.
const INLINE_NODE: Record<InlineFormat, string> = {
  bold: 'StrongEmphasis',
  italic: 'Emphasis',
  strike: 'Strikethrough',
  code: 'InlineCode',
  // The tags `<sub>` and `<sup>`, which the editor's parse reads as nodes (preview/script.ts).
  sub: 'Subscript',
  sup: 'Superscript',
};
/** What a format makes text, for a sentence. */
const INLINE_WORD: Record<InlineFormat, string> = {
  bold: 'bold',
  italic: 'italic',
  strike: 'struck through',
  code: 'code',
  sub: 'subscript',
  sup: 'superscript',
};

/** Whether the text of a cell is inside one node of `name` from end to end (hidden markers aside). */
function wholeIn(state: EditorState, cell: { textFrom: number; textTo: number }, name: string) {
  const start = around(state, pastHidden(state, cell.textFrom, true), 1).find(
    (n) => n.name === name,
  );
  return !!start && start.to >= pastHidden(state, cell.textTo, false);
}
const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;
/** What the Paragraph menu writes on an empty paragraph for a block type, as typing it would. */
const EMPTY_SYNTAX: Partial<Record<BlockType, string>> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  h4: '#### ',
  h5: '##### ',
  h6: '###### ',
  quote: '> ',
  ul: '- ',
  ol: '1. ',
  task: '- [ ] ',
};
/** A line that is the marker of a list item (and its box) or quote and nothing else. */
const EMPTY_MARKER = /^([ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(?:\[[ xX]\][ \t]*)?$/;
/** A list item with no text, as Return leaves one. */
const EMPTY_ITEM = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]*(?:\[[ xX]\][ \t]*)?$/;
const CODE_BLOCK = new Set(['FencedCode', 'CodeBlock']);

/** The nodes around `pos`, innermost first. */
function around(state: EditorState, pos: number, side: -1 | 0 | 1): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); node;) {
    nodes.push(node);
    node = node.parent;
  }
  return nodes;
}

/**
 * The nodes the main selection is in: around the caret, and for a selection around its start, so
 * that selecting just the bold words of a sentence reads as bold.
 */
function atSelection(state: EditorState): SyntaxNode[] {
  const { empty, head, from } = state.selection.main;
  return empty ? around(state, head, 0) : around(state, from, 1);
}

/** The ids of the block commands that are on where the selection is. */
function activeBlocks(state: EditorState): Set<string> {
  let on = activeBlocksCache.get(state);
  if (!on) activeBlocksCache.set(state, (on = computeActiveBlocks(state)));
  return on;
}

/** Computed once per state: the menu asks for each of its items. */
const activeBlocksCache = new WeakMap<EditorState, Set<string>>();

function computeActiveBlocks(state: EditorState): Set<string> {
  const nodes = atSelection(state);
  const on = new Set<string>();
  let list = false;
  for (const { name } of nodes) {
    const heading = HEADING.exec(name)?.[1];
    if (heading) on.add(`block.h${heading}`);
    else if (name === 'Blockquote') on.add('block.quote');
    else if (CODE_BLOCK.has(name)) on.add('block.code');
    else if (name === 'Task') {
      on.add('block.task');
      list = true;
    } else if (!list && name === 'BulletList') {
      on.add('block.ul');
      list = true;
    } else if (!list && name === 'OrderedList') {
      on.add('block.ol');
      list = true;
    }
  }
  const names = nodes.map(({ name }) => name);
  if (on.size === 0 && names.includes('Paragraph') && !names.includes('Table')) {
    on.add('block.body');
  }
  return on;
}

/** Whether `range` lies inside one marker comment of a change. */
function inMarker(state: EditorState, range: Range): boolean {
  return around(state, range.from, 1).some(
    ({ name, from, to }) =>
      (name === 'Comment' || name === 'CommentBlock') && from <= range.from && to >= range.to,
  );
}

/** The task item that starts at `pos`, or null where no task box is. */
function taskItemAt(state: EditorState, pos: number): SyntaxNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > state.doc.length) return null;
  const item = around(state, pos, 1).find(
    (node) => node.name === 'ListItem' && node.getChild('ListMark')?.from === pos,
  );
  return item?.getChild('Task')?.getChild('TaskMarker') ? item : null;
}

/**
 * The task items Check Item acts on: those whose box is on a line of the selection (a selection
 * that ends at the start of a line leaves that line out), or with none, the item the caret is in,
 * when that is a task item.
 */
function taskItemsIn(state: EditorState, from: number, to: number): SyntaxNode[] {
  const { doc } = state;
  const first = doc.lineAt(from);
  let last = doc.lineAt(to);
  if (to > from && to === last.from && last.number > first.number) last = doc.line(last.number - 1);
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    from: first.from,
    to: last.to,
    enter: (ref) => {
      if (ref.name !== 'ListItem') return;
      const mark = ref.node.getChild('ListMark');
      if (
        mark &&
        mark.from >= first.from &&
        mark.from <= last.to &&
        ref.node.getChild('Task')?.getChild('TaskMarker')
      ) {
        found.push(ref.node);
      }
    },
  });
  if (found.length > 0) return found;
  const item = around(state, from, 1).find(({ name }) => name === 'ListItem');
  return item?.getChild('Task')?.getChild('TaskMarker') ? [item] : [];
}

/** The text of the address of the link the selection is in, or null outside a link. */
function linkAt(state: EditorState): string | null {
  const link = atSelection(state).find(({ name }) => name === 'Link');
  if (!link) return null;
  const url = link.getChild('URL');
  return url ? state.sliceDoc(url.from, url.to) : '';
}

/** A time as the ledger writes it: UTC, to the minute. */
const ledgerTime = (date: Date) => `${date.toISOString().slice(0, 16)}Z`;

function personOf(author: Author): Person {
  const person: Person = { handle: author.handle, name: author.name };
  if (author.email !== undefined) person.email = author.email;
  if (author.agent !== undefined) person.agent = author.agent;
  if (author.for !== undefined) person.for = author.for;
  return person;
}

/**
 * Adds the formatting commands to an editor: Bold ⌘B, Italic ⌘I, Code ⌃`, Strikethrough ⌃⇧`,
 * Subscript ⌥⌘, Superscript ⌥⌘., Link… ⌘K and Clear Formatting ⌘\ in the Format menu, and in the
 * Paragraph menu Body ⇧⌘N, Headings
 * ⌘1 to ⌘6, Quote, lists, Check Item ⇧⌘U, Code Block, Table, Horizontal Rule, Indent ⌘] and
 * Outdent ⌘[. Returns a function that takes them out again.
 *
 * Register before the review interface, so that Add Comment is the last item of Format.
 */
export function createFormatting(editor: Editor, options: FormattingOptions): () => void {
  const { view } = editor;
  /** How many notices have been shown, to know whether a refusal said something. */
  let noticed = 0;
  const notice = (message: string) => {
    noticed++;
    options.notice(message);
  };
  const removeTheme = editor.addExtension(linkTheme);

  /** Whether the selection can be edited at all: Raw is read-only while edits are tracked. */
  const editable = (): boolean => {
    if (view.state.field(trackingField) && view.state.field(viewModeField) === 'raw') {
      notice(RAW_READ_ONLY);
      return false;
    }
    return true;
  };

  /** The selection, or with none the word under the caret. Null when there is neither. */
  const target = (): Range | null => {
    const { from, to, empty, head } = view.state.selection.main;
    if (!empty) return { from, to };
    const word = view.state.wordAt(head);
    return word ? { from: word.from, to: word.to } : null;
  };

  /**
   * Puts changes into the document as one step to undo. With `final` they are what the format
   * library made, markers and all, and Track Changes must not take them for typing; otherwise they
   * count as typing, which Track Changes records as insertions or writes plainly.
   */
  const put = (changes: readonly TextChange[], userEvent: string, final: boolean): boolean => {
    if (changes.length === 0) return false;
    const before = view.state.doc;
    const tracked = view.state.field(trackingField);
    view.dispatch({
      changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
      annotations: [isolateHistory.of('full'), ...(final ? [trackedEditAnnotation.of(true)] : [])],
      userEvent,
      scrollIntoView: true,
    });
    // A tracked change made in Clean shows in the markup view, as typing does.
    if (tracked && view.state.doc !== before && view.state.field(viewModeField) === 'clean') {
      view.dispatch({ effects: setViewModeEffect.of(view.state.facet(markupViewFacet)) });
    }
    return view.state.doc !== before;
  };

  /** Changes the format of `range`: tracked, or written directly with Track Changes off. */
  const format = (
    range: Range,
    op: FormatOp,
    userEvent: string,
    explain: (error: EditError) => string = (error) => error.message,
  ): boolean => {
    if (!editable()) return false;
    const text = view.state.doc.toString();
    const person = personOf(options.author);
    try {
      if (view.state.field(trackingField)) {
        const { changes } = trackedFormat(text, range, op, {
          author: person,
          time: ledgerTime(new Date()),
        });
        // What the format library made is final, markers and all: Track Changes must not see it
        // as typing.
        return put(changes, userEvent, true);
      }
      return put(untrackedFormat(text, range, op, { author: person }), userEvent, true);
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      notice(explain(error));
      return false;
    }
  };

  /** Inserts text as typing: an insertion with Track Changes on, plain text with it off. */
  const insert = (changes: readonly TextChange[]): boolean =>
    editable() && put(changes, 'input.format', false);

  /**
   * Makes `op` on each of `ranges` (in the document's order) as one change and one step to undo:
   * from the last to the first, each on the text the ones after it left, composed into one set.
   */
  const formatRanges = (
    ranges: readonly Range[],
    op: FormatOp,
    userEvent: string,
    explain: (error: EditError) => string = (error) => error.message,
  ): boolean => {
    if (!editable()) return false;
    if (ranges.length === 0) return false;
    const person = personOf(options.author);
    const tracked = view.state.field(trackingField);
    let text = view.state.doc.toString();
    let total = ChangeSet.empty(text.length);
    // The changes of several ranges are decided together (format §3.7).
    const group = tracked && ranges.length > 1 ? newId(idsIn(text)) : undefined;
    // The formats of text are made at once: the format library reads the text once, and checks
    // each cell of a table against its own marks.
    if (tracked && (op.kind === 'inline' || op.kind === 'clear')) {
      try {
        const made = trackedFormatRanges(text, ranges, op, {
          author: person,
          time: ledgerTime(new Date()),
          ...(group === undefined ? {} : { group }),
        });
        return put(made.changes, userEvent, true);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        notice(explain(error));
        return false;
      }
    }
    try {
      for (const found of ranges.toReversed()) {
        const range = { from: total.mapPos(found.from, -1), to: total.mapPos(found.to, 1) };
        const made = tracked
          ? trackedFormat(text, range, op, {
              author: person,
              time: ledgerTime(new Date()),
              ...(group === undefined ? {} : { group }),
            }).changes
          : untrackedFormat(text, range, op, { author: person });
        const step = ChangeSet.of(
          made.map(({ from, to, insert }) => ({ from, to, insert })),
          text.length,
        );
        text = applyChanges(text, made);
        total = total.compose(step);
      }
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      notice(explain(error));
      return false;
    }
    const changes: TextChange[] = [];
    total.iterChanges((from, to, _fromB, _toB, inserted) =>
      changes.push({ from, to, insert: inserted.toString() }),
    );
    return put(changes, userEvent, true);
  };

  /**
   * Changes the format of the text of every selected cell, as one change and one step to undo.
   */
  const formatCells = (op: FormatOp, userEvent: string): boolean =>
    formatRanges(
      selectedCells(view.state)
        .filter((cell) => cell.textFrom < cell.textTo)
        .map((cell) => ({ from: cell.textFrom, to: cell.textTo })),
      op,
      userEvent,
    );

  const inline =
    (format_: InlineFormat): EditorCommand['run'] =>
    () => {
      if (rectOf(view.state)) {
        // Cells selected: on unless the text of every cell has the format already, as for a
        // paragraph selection; with no text in any of them there is nothing to format.
        const texts = selectedCells(view.state).filter((cell) => cell.textFrom < cell.textTo);
        if (texts.length === 0) {
          notice(`There is no text in the selected cells to make ${INLINE_WORD[format_]}.`);
          return false;
        }
        const on = !texts.every((cell) => wholeIn(view.state, cell, INLINE_NODE[format_]));
        return formatCells({ kind: 'inline', format: format_, on }, `format.${format_}`);
      }
      const range = target();
      if (!range) return false;
      if (inMarker(view.state, range)) {
        notice(MARKER_ONLY);
        return false;
      }
      const on = !atSelection(view.state).some(({ name }) => name === INLINE_NODE[format_]);
      const saidBefore = noticed;
      const done = format(range, { kind: 'inline', format: format_, on }, `format.${format_}`);
      // The parse says the format is on and the format's reader finds none to take off, as it can
      // pair a tag otherwise (it reads emphasis first): nothing happened, and says why.
      if (!done && !on && noticed === saidBefore && (format_ === 'sub' || format_ === 'sup')) {
        notice(TAGS_NOT_A_PAIR);
      }
      return done;
    };

  const block =
    (to: BlockType, id: string): EditorCommand['run'] =>
    () => {
      const { from, to: end, empty } = view.state.selection.main;
      // On an empty paragraph there is no block to change: the menu writes the block's syntax
      // there, as typing it does (#170). Body does nothing.
      if (empty && onEmptyLine()) {
        const syntax = EMPTY_SYNTAX[to];
        return syntax === undefined ? to === 'p' : putOnEmptyLine(syntax, syntax, syntax.length);
      }
      const toggledOff = to !== 'p' && activeBlocks(view.state).has(id);
      const what = /^h[1-6]$/.test(to) ? 'a heading' : to === 'quote' ? 'a quote' : null;
      if (what && !toggledOff && atSelection(view.state).some(({ name }) => name === 'ListItem')) {
        notice(NOT_IN_ITEM(what));
        return false;
      }
      // An item with no text can't change type, and the library's words are about another thing.
      const emptyItem = EMPTY_ITEM.test(view.state.doc.lineAt(from).text);
      return format(
        { from, to: end },
        { kind: 'block', to: toggledOff ? 'p' : to },
        'format.block',
        emptyItem ? () => WRITE_ITEM : undefined,
      );
    };

  /**
   * Where `count` characters that a reader sees stand after `from` in the document: the markers of
   * tracked changes in between are not counted, so that a place in a block that was inserted as a
   * tracked change is the one its text asks for.
   */
  const afterVisible = (from: number, count: number): number => {
    const text = view.state.doc.toString();
    let at = from;
    for (let seen = 0; seen < count && at < text.length;) {
      if (text.startsWith('<!--', at)) {
        const end = text.indexOf('-->', at);
        at = end === -1 ? text.length : end + 3;
      } else {
        at++;
        seen++;
      }
    }
    return at;
  };

  /**
   * Whether the caret is on an empty line, as Return leaves one. A line of a list item's or a
   * quote's marker only isn't: the block would go in front of it.
   */
  const onEmptyLine = (): boolean => {
    const { doc } = view.state;
    const line = doc.lineAt(view.state.selection.main.head);
    return line.text.trim() === '' && !atSelection(view.state).some((n) => n.parent?.type.isTop);
  };

  /**
   * Writes `text`, a block, on the caret's empty line, keeping a blank line between it and each
   * neighbor it would touch (the line above, if it has text, and the one below), then puts the
   * caret `caret` characters into the block, after `find` has located its start in the document.
   * One rule for every inserted block.
   */
  const putOnEmptyLine = (text: string, find: string, caret: number, selected = 0): boolean => {
    const { doc } = view.state;
    const line = doc.lineAt(view.state.selection.main.head);
    const above = line.number > 1 && doc.line(line.number - 1).text.trim() !== '';
    const below = line.number < doc.lines && doc.line(line.number + 1).text.trim() !== '';
    // With text below, the block goes in at the start of that line, with the blank line after it,
    // in front of the text: the line above already has the caret's empty line between. A tracked
    // insertion can't end with a single line break, and this is one block with its own.
    const at = below ? line.to + 1 : line.to;
    const done = insert([
      { from: at, to: at, insert: below ? `${text}\n\n` : `${above ? '\n' : ''}${text}` },
    ]);
    if (done) {
      const start = view.state.doc.toString().indexOf(find, line.from);
      if (start >= 0) {
        const anchor = afterVisible(start, caret);
        view.dispatch({ selection: { anchor, head: afterVisible(anchor, selected) } });
      }
    }
    return done;
  };

  /** Where a block inserted for the caret goes: after the block it is in, as its own paragraph. */
  const insertBlock = (text: string, find: string, caret: number, selected = 0): boolean => {
    if (onEmptyLine()) return putOnEmptyLine(text, find, caret, selected);
    const { doc } = view.state;
    const { head } = view.state.selection.main;
    const line = doc.lineAt(head);
    const top = atSelection(view.state).find((node) => node.parent?.type.isTop);
    const at = top ? Math.max(top.to, line.to) : line.to;
    const done = insert([{ from: at, to: at, insert: `\n\n${text}` }]);
    if (done && selected > 0) {
      const start = view.state.doc.toString().indexOf(find, at);
      if (start >= 0) {
        const anchor = afterVisible(start, caret);
        view.dispatch({ selection: { anchor, head: afterVisible(anchor, selected) } });
      }
    }
    return done;
  };

  const codeBlock = (): boolean => {
    const nodes = atSelection(view.state);
    if (nodes.some(({ name }) => CODE_BLOCK.has(name))) {
      notice(ALREADY_CODE);
      return false;
    }
    if (nodes.some(({ name }) => name === 'ListItem' || name === 'Blockquote')) {
      notice(NO_CODE_IN_CONTAINER);
      return false;
    }
    const { doc } = view.state;
    const { from, to, empty } = view.state.selection.main;
    let first = doc.lineAt(from);
    let last = doc.lineAt(to);
    // A selection that ends at the start of a line doesn't take that line.
    if (!empty && to === last.from && last.number > first.number) last = doc.line(last.number - 1);
    if (empty) {
      // The paragraph the caret is in.
      const paragraph = nodes.find(({ name }) => name === 'Paragraph');
      if (paragraph) {
        first = doc.lineAt(paragraph.from);
        last = doc.lineAt(paragraph.to);
      }
    }
    // A tracked change keeps a heading's `#`s in front of the text it changes (format §3.4), and a
    // fence after them would be no fence.
    const lines = doc.sliceString(first.from, last.to).split('\n');
    if (
      view.state.field(trackingField) &&
      lines.some((line) => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line))
    ) {
      notice(NO_TRACKED_HEADING_CODE);
      return false;
    }
    if (first.number === last.number) {
      if (first.text.trim() === '') return putOnEmptyLine('```\n\n```', '```\n', 4);
      // An empty list item or quote line: its marker stays outside the fence. A quote's fence
      // goes after the marker, on its line; an item's on the lines below, indented to its text.
      const marker = EMPTY_MARKER.exec(first.text);
      const lead = marker?.[1] ?? '';
      if (marker && /[>*+\-\d]/.test(lead)) {
        const quote = lead.includes('>');
        const inside = lead.replace(/[^>\s]/g, ' ') + (quote && !/\s$/.test(lead) ? ' ' : '');
        const start = first.to;
        const done = insert([
          {
            from: start,
            to: start,
            insert: quote
              ? `${first.text.endsWith(' ') ? '' : ' '}\`\`\`\n${inside}\n${inside}\`\`\``
              : `\n${inside}\`\`\`\n${inside}\n${inside}\`\`\``,
          },
        ]);
        if (done) {
          const open = view.state.doc.toString().indexOf('```\n', first.from);
          if (open >= 0) view.dispatch({ selection: { anchor: open + 4 + inside.length } });
        }
        return done;
      }
    }
    const text = doc.sliceString(first.from, last.to);
    // The markers of changes in the lines would be copied into the code as text.
    if (text.includes('<!--')) {
      notice(MARKS_IN_CODE);
      return false;
    }
    // The fence is longer than any run of backticks inside it. It goes in as one edit: each fence
    // by itself leaves a code block open, which no file may have, so each is refused alone.
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return insert([{ from: first.from, to: last.to, insert: `${fence}\n${text}\n${fence}` }]);
  };

  const openLink = (): boolean => {
    const range = target();
    if (!range) return false;
    const url = linkAt(view.state) ?? '';
    openLinkPopover(view, {
      at: range.to,
      url,
      apply: (next) => void format(range, { kind: 'link', url: next }, 'format.link'),
    });
    return true;
  };

  const TABLE = '| Column | Column |\n| --- | --- |\n|  |  |';

  const command = (
    menu: 'format' | 'paragraph',
    group: string,
    fields: Omit<EditorCommand, 'menu' | 'group'>,
  ): EditorCommand => ({
    menu,
    group,
    // A table's cell holds inline text: the Paragraph menu's block commands are not for it.
    ...(menu === 'paragraph'
      ? { isEnabled: (state: EditorState) => !selectionInTable(state) }
      : {}),
    ...fields,
  });

  const inlineCommand = (
    id: string,
    title: string,
    shortcut: string,
    format_: InlineFormat,
  ): EditorCommand =>
    command('format', 'text', {
      id,
      title,
      shortcut,
      run: inline(format_),
      isActive: (state) => atSelection(state).some(({ name }) => name === INLINE_NODE[format_]),
    });

  const blockCommand = (
    id: string,
    title: string,
    shortcut: string | undefined,
    to: BlockType,
    group: string,
  ): EditorCommand =>
    command('paragraph', group, {
      id,
      title,
      ...(shortcut ? { shortcut } : {}),
      run: block(to, id),
      isActive: (state) => activeBlocks(state).has(id),
    });

  /** Who else has a pending change to the box on the line at `pos`: their name, or null. */
  const otherBoxChange = (pos: number): string | null => {
    const { state } = view;
    const line = state.doc.lineAt(pos);
    const parsed = state.field(parsedField);
    for (const mark of parsed.marks) {
      if (mark.kind !== 'fmt' || mark.entry.by === options.author.handle) continue;
      const here = mark.segments.some(
        ({ open }) =>
          open.from >= line.from &&
          open.to <= line.to &&
          boxChange(state.sliceDoc(open.from, open.to)) !== null,
      );
      if (!here) continue;
      const person = parsed.ledger.people.find(({ handle }) => handle === mark.entry.by);
      return person?.name ?? mark.entry.by;
    }
    return null;
  };

  /** Words for why a box can't change, in place of the format library's about blocks. */
  const boxRefusal = (pos: number) => (error: EditError) => {
    const line = view.state.doc.lineAt(pos);
    const rest = line.text.slice(line.text.search(/\[[ xX]\]/) + 3);
    // What the library says about changes pending in the paragraph is accurate for a box too.
    if (/^Accept or reject/.test(error.message)) return error.message;
    const many = /^There are (\d+) pending changes in this (\w+), too many/.exec(error.message);
    const again = error.message.endsWith('would be read again.')
      ? ' The lines below would be read again.'
      : '';
    if (many) {
      return `This box can't be changed while ${many[1]} changes in its ${many[2]} are pending. Accept or reject some of them first.${again}`;
    }
    if (/<!--/.test(rest)) return CHANGE_IN_WAY;
    return rest.trim() === '' ? WRITE_ITEM : BOX_STUCK;
  };

  /** Checks or unchecks the box of the task item at `pos`, if there still is one. */
  const clickBox = (pos: number, checked: boolean) => {
    const item = taskItemAt(view.state, pos);
    if (!item) return;
    const name = otherBoxChange(pos);
    if (name !== null) {
      notice(`Accept or reject ${name}'s change to this box first.`);
      return;
    }
    format({ from: pos, to: pos }, { kind: 'check', checked }, 'format.check', boxRefusal(pos));
  };

  /**
   * Paragraph › Check Item: checks the task items of the selection, or unchecks them when all of
   * them are checked already, as one change (tracked as a click on each box is) and one step to
   * undo. An item with no text has no box to change.
   */
  const checkItems = (): boolean => {
    if (!editable()) return false;
    const { state } = view;
    const { from, to } = state.selection.main;
    const items = taskItemsIn(state, from, to);
    const boxes = items.map((item) => {
      const mark = item.getChild('ListMark');
      const marker = item.getChild('Task')?.getChild('TaskMarker');
      const line = state.doc.lineAt(mark?.from ?? item.from);
      const rest = line.text.slice((marker?.to ?? item.from) - line.from);
      return {
        pos: mark?.from ?? item.from,
        lineTo: line.to,
        checked: /\[[xX]\]/.test(marker ? state.sliceDoc(marker.from, marker.to) : ''),
        written: rest.replace(/<!--[^]*?-->/g, '').trim() !== '',
      };
    });
    if (boxes.length === 0) {
      notice(NO_BOX);
      return false;
    }
    const written = boxes.filter((box) => box.written);
    const [first] = written;
    if (!first) {
      notice(WRITE_ITEM);
      return false;
    }
    for (const box of written) {
      const name = otherBoxChange(box.pos);
      if (name !== null) {
        notice(`Accept or reject ${name}'s change to this box first.`);
        return false;
      }
    }
    const checked = !written.every((box) => box.checked);
    // The items with text in each stretch with no empty item in it: an empty item is not a box to
    // change, and a range over it would be refused. One item is the point a click is at; several
    // are a range from the first box to the end of the last item's first line. All of them are
    // one change.
    const runs: Range[] = [];
    let run: (typeof boxes)[number][] = [];
    const close = () => {
      // A change takes up to six items at a time (format §2.6): longer stretches go by sixes, the
      // last first, as one change still.
      const parts: Range[] = [];
      for (let end = run.length; end > 0; end -= CHECK_AT_A_TIME) {
        const part = run.slice(Math.max(0, end - CHECK_AT_A_TIME), end);
        const [head] = part;
        const tail = part.at(-1);
        if (head && tail) {
          parts.unshift({ from: head.pos, to: part.length === 1 ? head.pos : tail.lineTo });
        }
      }
      runs.push(...parts);
      run = [];
    };
    for (const box of boxes) {
      if (box.written) run.push(box);
      else close();
    }
    close();
    let refused = false;
    const explain = boxRefusal(first.pos);
    const done = formatRanges(runs, { kind: 'check', checked }, 'format.check', (error) => {
      refused = true;
      return explain(error);
    });
    if (!done && !refused) notice(NOT_CHECKED);
    return done;
  };

  /** A click on a task box asks for it to be checked or unchecked; this makes the change. */
  function listenForBoxes(): () => void {
    return editor.addExtension(
      EditorView.updateListener.of(({ transactions, docChanged }) => {
        // A link popover is for the text it was opened on.
        if (docChanged) closeLinkPopover(view);
        for (const tr of transactions) {
          for (const effect of tr.effects) {
            if (!effect.is(checkBoxEffect)) continue;
            const { pos, checked } = effect.value;
            // The position is the transaction's; what is there now is checked before anything.
            if (!Number.isInteger(pos) || pos < 0 || pos > tr.startState.doc.length) continue;
            clickBox(tr.changes.mapPos(pos, 1), checked);
          }
        }
      }),
    );
  }

  /**
   * The menu in an alert's title asks for the types (`calloutMenuEffect`): the menu hangs from the
   * button, and choosing a type is a block format change of the alert, tracked or plain.
   */
  function listenForCalloutMenu(): () => void {
    const ask = ({ pos, type, anchor }: CalloutMenuRequest) => {
      const { doc } = view.state;
      // The place is the alert's, if it still is: the text may have changed since the press.
      if (!Number.isInteger(pos) || pos < 0 || pos > doc.length) return;
      if (!/^>[ \t]?\[![A-Za-z]/.test(doc.lineAt(pos).text)) return;
      // GitHub's types, and any other that a file has already: it is the file's to offer.
      const others: string[] = [];
      for (const found of doc.toString().matchAll(/^>[ \t]?\[!([A-Za-z][A-Za-z0-9-]*)\]/gm)) {
        const other = (found[1] ?? '').toLowerCase();
        if (!GITHUB_TYPES.includes(other) && !others.includes(other)) others.push(other);
      }
      openCalloutMenu(view, {
        anchor,
        types: [...GITHUB_TYPES, ...others].map((each) => ({
          type: each,
          name: calloutName(each),
        })),
        current: type,
        choose: (to) =>
          void format({ from: pos, to: pos }, { kind: 'callout', type: to }, 'format.callout'),
      });
    };
    return editor.addExtension([
      calloutMenuTheme,
      EditorView.updateListener.of(({ transactions, docChanged }) => {
        // A menu is for the text it was opened on.
        if (docChanged) closeCalloutMenu(view);
        for (const tr of transactions) {
          for (const effect of tr.effects) if (effect.is(calloutMenuEffect)) ask(effect.value);
        }
      }),
    ]);
  }

  const commands: EditorCommand[] = [
    inlineCommand('format.bold', 'Bold', 'Mod-b', 'bold'),
    inlineCommand('format.italic', 'Italic', 'Mod-i', 'italic'),
    inlineCommand('format.code', 'Code', 'Ctrl-`', 'code'),
    inlineCommand('format.strike', 'Strikethrough', 'Ctrl-Shift-`', 'strike'),
    // Word's keys for these, ⌘= and ⇧⌘=, are View's Zoom In. Google Docs' ⌘, and ⌘. are Preferences and
    // Cancel on the Mac, so these take ⌥ too.
    inlineCommand('format.sub', 'Subscript', 'Mod-Alt-,', 'sub'),
    inlineCommand('format.sup', 'Superscript', 'Mod-Alt-.', 'sup'),
    command('format', 'link', {
      id: 'format.link',
      title: 'Link…',
      shortcut: 'Mod-k',
      // Cells selected have no one range to link.
      isEnabled: (state) => !rectOf(state),
      run: openLink,
      isActive: (state) => linkAt(state) !== null,
    }),
    command('format', 'clear', {
      id: 'format.clear',
      title: 'Clear Formatting',
      shortcut: 'Mod-\\',
      run: () => {
        if (rectOf(view.state)) return formatCells({ kind: 'clear' }, 'format.clear');
        const range = target();
        return !!range && format(range, { kind: 'clear' }, 'format.clear');
      },
    }),

    blockCommand('block.body', 'Body', 'Mod-Shift-n', 'p', 'type'),
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      blockCommand(`block.h${level}`, `Heading ${level}`, `Mod-${level}`, `h${level}`, 'type'),
    ),
    blockCommand('block.quote', 'Quote', 'Mod-Alt-q', 'quote', 'list'),
    blockCommand('block.ul', 'Bulleted List', 'Mod-Alt-u', 'ul', 'list'),
    blockCommand('block.ol', 'Numbered List', 'Mod-Alt-o', 'ol', 'list'),
    blockCommand('block.task', 'Task List', 'Mod-Alt-x', 'task', 'list'),
    command('paragraph', 'list', {
      id: 'block.check',
      title: 'Check Item',
      shortcut: 'Mod-Shift-u',
      run: checkItems,
    }),
    command('paragraph', 'insert', {
      id: 'block.code',
      title: 'Code Block',
      shortcut: 'Mod-Alt-c',
      run: codeBlock,
      isActive: (state) => activeBlocks(state).has('block.code'),
    }),
    command('paragraph', 'insert', {
      id: 'block.table',
      title: 'Table',
      shortcut: 'Mod-Alt-t',
      // The first header cell's text is selected, so that typing names the column.
      run: () => insertBlock(TABLE, '| Column', 2, 'Column'.length),
    }),
    command('paragraph', 'insert', {
      id: 'block.alert',
      title: 'Alert',
      // A new alert after the block the caret is in, or on the empty paragraph it is in, with its
      // body's text selected: the type is changed from the menu in its title.
      run: () =>
        insertBlock(ALERT, '> [!NOTE]', ALERT.length - ALERT_BODY.length, ALERT_BODY.length),
    }),
    command('paragraph', 'insert', {
      id: 'block.rule',
      title: 'Horizontal Rule',
      run: () => insertBlock('---', '---', 3),
    }),
    command('paragraph', 'indent', {
      id: 'block.indent',
      title: 'Indent',
      shortcut: 'Mod-]',
      run: () => {
        if (!editable()) return false;
        if (indentItems(view, false)) return true;
        const { from, to } = view.state.selection.main;
        return format({ from, to }, { kind: 'indent', by: 1 }, 'format.indent');
      },
    }),
    command('paragraph', 'indent', {
      id: 'block.outdent',
      title: 'Outdent',
      shortcut: 'Mod-[',
      run: () => {
        if (!editable()) return false;
        if (indentItems(view, true)) return true;
        const { from, to } = view.state.selection.main;
        return format({ from, to }, { kind: 'indent', by: -1 }, 'format.indent');
      },
    }),
  ];

  const removeCommands = editor.commands.register(commands);
  const removeBoxes = listenForBoxes();
  const removeCalloutMenu = listenForCalloutMenu();
  return () => {
    closeLinkPopover(view);
    closeCalloutMenu(view);
    removeCommands();
    removeBoxes();
    removeCalloutMenu();
    removeTheme();
  };
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.formatting',
    name: 'Formatting',
    version: '0.0.0',
    needs: ['document:read', 'document:edit'],
    contributes: {
      commands: [
        { id: 'format.bold', title: 'Bold', shortcut: 'Mod-b' },
        { id: 'format.italic', title: 'Italic', shortcut: 'Mod-i' },
        { id: 'format.code', title: 'Code', shortcut: 'Ctrl-`' },
        { id: 'format.strike', title: 'Strikethrough', shortcut: 'Ctrl-Shift-`' },
        { id: 'format.sub', title: 'Subscript', shortcut: 'Mod-Alt-,' },
        { id: 'format.sup', title: 'Superscript', shortcut: 'Mod-Alt-.' },
        { id: 'format.link', title: 'Link…', shortcut: 'Mod-k' },
        { id: 'format.clear', title: 'Clear Formatting', shortcut: 'Mod-\\' },
        { id: 'block.body', title: 'Body', shortcut: 'Mod-Shift-n' },
        { id: 'block.h1', title: 'Heading 1', shortcut: 'Mod-1' },
        { id: 'block.h2', title: 'Heading 2', shortcut: 'Mod-2' },
        { id: 'block.h3', title: 'Heading 3', shortcut: 'Mod-3' },
        { id: 'block.h4', title: 'Heading 4', shortcut: 'Mod-4' },
        { id: 'block.h5', title: 'Heading 5', shortcut: 'Mod-5' },
        { id: 'block.h6', title: 'Heading 6', shortcut: 'Mod-6' },
        { id: 'block.quote', title: 'Quote', shortcut: 'Mod-Alt-q' },
        { id: 'block.ul', title: 'Bulleted List', shortcut: 'Mod-Alt-u' },
        { id: 'block.ol', title: 'Numbered List', shortcut: 'Mod-Alt-o' },
        { id: 'block.task', title: 'Task List', shortcut: 'Mod-Alt-x' },
        { id: 'block.check', title: 'Check Item', shortcut: 'Mod-Shift-u' },
        { id: 'block.code', title: 'Code Block', shortcut: 'Mod-Alt-c' },
        { id: 'block.table', title: 'Table', shortcut: 'Mod-Alt-t' },
        { id: 'block.alert', title: 'Alert' },
        { id: 'block.rule', title: 'Horizontal Rule' },
        { id: 'block.indent', title: 'Indent', shortcut: 'Mod-]' },
        { id: 'block.outdent', title: 'Outdent', shortcut: 'Mod-[' },
      ],
    },
  },
  activate: (context) =>
    createFormatting(context.editor as Editor, {
      author: context.author,
      notice: (message) => context.notice(message),
    }),
};
