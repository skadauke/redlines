// Formatting commands (spec: Menus): bold, italic, code, strikethrough, links and clearing for
// text, and the type of a paragraph, its lists, and the table, rule and code block that start one.
// They are commands of the registry, which binds their keys and draws the Format and Paragraph
// menus; none has a button. With Track Changes on a format change is a tracked `fmt` mark, with it
// off the syntax is written directly, and what a block adds is an insertion like typing.

import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { EditorView } from '@codemirror/view';
import {
  type Author,
  checkBoxEffect,
  type Editor,
  parsedField,
  type EditorCommand,
  setViewModeEffect,
  trackedEditAnnotation,
  trackingField,
  viewModeField,
} from '@redlines/editor';
import {
  type BlockType,
  EditError,
  type FormatOp,
  type InlineFormat,
  type Person,
  type Range,
  type TextChange,
  trackedFormat,
  untrackedFormat,
} from '@redlines/format';
import type { Plugin } from '@redlines/plugin-api';
import { closeLinkPopover, linkTheme, openLinkPopover } from './link-popover.ts';

export interface FormattingOptions {
  /** Who formats. Read at each command, so a change of name in Preferences shows. */
  author: Author;
  /** Shows a one-line message for what can't be done. Nothing is changed then. */
  notice(message: string): void;
}

const RAW_READ_ONLY =
  'Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.';
const ALREADY_CODE = 'This is already a code block.';
const MARKS_IN_CODE =
  'Accept or reject the changes in these lines first, then make them a code block.';
const MARKER_ONLY =
  'The selection is only the marker of a change. Select some of the text to format it.';
const NOT_IN_ITEM = (what: string) =>
  `A list item can't become ${what}. Take it out of the list first.`;
const WRITE_ITEM = 'Write the item first.';
const CHANGE_IN_WAY = 'A pending change in this item is in the way. Accept or reject it first.';
const BOX_STUCK = "This box can't be changed here. Turn off Track Changes to change it.";
const NO_CODE_IN_CONTAINER = "A code block can't be made inside a list or a quote yet.";
const NO_TRACKED_HEADING_CODE =
  "A heading can't become a code block while Track Changes is on. Make it body text first.";

// What the syntax tree calls them.
const INLINE_NODE: Record<InlineFormat, string> = {
  bold: 'StrongEmphasis',
  italic: 'Emphasis',
  strike: 'Strikethrough',
  code: 'InlineCode',
};
const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;
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
 * Link… ⌘K and Clear Formatting ⌘\ in the Format menu, and in the Paragraph menu Body ⌘0, Headings
 * ⌘1 to ⌘6, Quote, lists, Code Block, Table, Horizontal Rule, Indent ⌘] and Outdent ⌘[. Returns a
 * function that takes them out again.
 *
 * Register before the review interface, so that Add Comment is the last item of Format.
 */
export function createFormatting(editor: Editor, options: FormattingOptions): () => void {
  const { view } = editor;
  const notice = (message: string) => options.notice(message);
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
    // A tracked change made in Clean shows in Redlines, as typing does.
    if (tracked && view.state.doc !== before && view.state.field(viewModeField) === 'clean') {
      view.dispatch({ effects: setViewModeEffect.of('redlines') });
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

  const inline =
    (format_: InlineFormat): EditorCommand['run'] =>
    () => {
      const range = target();
      if (!range) return false;
      if (inMarker(view.state, range)) {
        notice(MARKER_ONLY);
        return false;
      }
      const on = !atSelection(view.state).some(({ name }) => name === INLINE_NODE[format_]);
      return format(range, { kind: 'inline', format: format_, on }, `format.${format_}`);
    };

  const block =
    (to: BlockType, id: string): EditorCommand['run'] =>
    () => {
      const { from, to: end } = view.state.selection.main;
      const toggledOff = to !== 'p' && activeBlocks(view.state).has(id);
      const what = /^h[1-6]$/.test(to) ? 'a heading' : to === 'quote' ? 'a quote' : null;
      if (what && !toggledOff && atSelection(view.state).some(({ name }) => name === 'ListItem')) {
        notice(NOT_IN_ITEM(what));
        return false;
      }
      return format(
        { from, to: end },
        { kind: 'block', to: toggledOff ? 'p' : to },
        'format.block',
      );
    };

  /** Where a block inserted for the caret goes: after the block it is in, as its own paragraph. */
  const insertBlock = (text: string): boolean => {
    const { doc } = view.state;
    const { head } = view.state.selection.main;
    const line = doc.lineAt(head);
    const top = atSelection(view.state).find((node) => node.parent?.type.isTop);
    const at = top ? Math.max(top.to, line.to) : line.to;
    const blank = !top && line.text.trim() === '';
    return insert([{ from: at, to: at, insert: blank ? text : `\n\n${text}` }]);
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
    const blank = first.number === last.number && first.text.trim() === '';
    if (blank) return insert([{ from: first.from, to: first.from, insert: '```\n\n```' }]);
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
  ): EditorCommand => ({ menu, group, ...fields });

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
          /[+-]check\b/.test(state.sliceDoc(open.from, open.to)),
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
    if (error.message.startsWith('Accept or reject')) return error.message;
    if (/<!--/.test(rest)) return CHANGE_IN_WAY;
    return rest.trim() === '' ? WRITE_ITEM : BOX_STUCK;
  };

  /** Checks or unchecks the box of the task item at `pos`, if there still is one. */
  const clickBox = (pos: number, checked: boolean) => {
    if (!taskItemAt(view.state, pos)) return;
    const name = otherBoxChange(pos);
    if (name !== null) {
      notice(`Accept or reject ${name}'s change to this box first.`);
      return;
    }
    format({ from: pos, to: pos }, { kind: 'check', checked }, 'format.check', boxRefusal(pos));
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

  const commands: EditorCommand[] = [
    inlineCommand('format.bold', 'Bold', 'Mod-b', 'bold'),
    inlineCommand('format.italic', 'Italic', 'Mod-i', 'italic'),
    inlineCommand('format.code', 'Code', 'Ctrl-`', 'code'),
    inlineCommand('format.strike', 'Strikethrough', 'Ctrl-Shift-`', 'strike'),
    command('format', 'link', {
      id: 'format.link',
      title: 'Link…',
      shortcut: 'Mod-k',
      run: openLink,
      isActive: (state) => linkAt(state) !== null,
    }),
    command('format', 'clear', {
      id: 'format.clear',
      title: 'Clear Formatting',
      shortcut: 'Mod-\\',
      run: () => {
        const range = target();
        return !!range && format(range, { kind: 'clear' }, 'format.clear');
      },
    }),

    blockCommand('block.body', 'Body', 'Mod-0', 'p', 'type'),
    ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
      blockCommand(`block.h${level}`, `Heading ${level}`, `Mod-${level}`, `h${level}`, 'type'),
    ),
    blockCommand('block.quote', 'Quote', 'Mod-Alt-q', 'quote', 'list'),
    blockCommand('block.ul', 'Bulleted List', 'Mod-Alt-u', 'ul', 'list'),
    blockCommand('block.ol', 'Numbered List', 'Mod-Alt-o', 'ol', 'list'),
    blockCommand('block.task', 'Task List', 'Mod-Alt-x', 'task', 'list'),
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
      run: () => insertBlock(TABLE),
    }),
    command('paragraph', 'insert', {
      id: 'block.rule',
      title: 'Horizontal Rule',
      run: () => insertBlock('---'),
    }),
    command('paragraph', 'indent', {
      id: 'block.indent',
      title: 'Indent',
      shortcut: 'Mod-]',
      run: () => {
        const { from, to } = view.state.selection.main;
        return format({ from, to }, { kind: 'indent', by: 1 }, 'format.indent');
      },
    }),
    command('paragraph', 'indent', {
      id: 'block.outdent',
      title: 'Outdent',
      shortcut: 'Mod-[',
      run: () => {
        const { from, to } = view.state.selection.main;
        return format({ from, to }, { kind: 'indent', by: -1 }, 'format.indent');
      },
    }),
  ];

  const removeCommands = editor.commands.register(commands);
  const removeBoxes = listenForBoxes();
  return () => {
    closeLinkPopover(view);
    removeCommands();
    removeBoxes();
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
        { id: 'format.link', title: 'Link…', shortcut: 'Mod-k' },
        { id: 'format.clear', title: 'Clear Formatting', shortcut: 'Mod-\\' },
        { id: 'block.body', title: 'Body', shortcut: 'Mod-0' },
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
        { id: 'block.code', title: 'Code Block', shortcut: 'Mod-Alt-c' },
        { id: 'block.table', title: 'Table', shortcut: 'Mod-Alt-t' },
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
