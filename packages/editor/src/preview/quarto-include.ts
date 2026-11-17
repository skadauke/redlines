// Includes of a Quarto file (docs/research/quarto.md, decision 4): a line that holds only
// `{{< include _part.qmd >}}` is drawn as a collapsed block with the included file's name, the count
// of the changes pending in it and an Open button, and expands to a read-only preview of the file as
// it stands now. The included file is a file of its own, with its own ledger (several ledgers,
// format §5.8); the block only reads it, through the host, and never edits it. The source shows while
// the caret is on the line. Only a pandoc file has includes.

import { type EditorState, type Extension, type Range, StateField, Facet } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { newestView, parse } from '@redlines/format';
import type { IncludeHost } from '../api.ts';
import { dialectFacet } from '../dialect.ts';
import { isChange, viewModeField } from '../tracked/field.ts';

/** The host's way to reach included files; without it the block names the file and does no more. */
export const includeFacet = Facet.define<IncludeHost, IncludeHost | null>({
  combine: (values) => values[0] ?? null,
});

/** A line that is an include shortcode alone: `{{< include path >}}`, any spacing, either quotes. */
const INCLUDE =
  /^[ \t]*\{\{<[ \t]+include[ \t]+(?:"([^"]+)"|'([^']+)'|([^\s>]+))[ \t]+>\}\}[ \t]*$/;

/** The path an include line names, or null when the line is not one. */
export function includePath(line: string): string | null {
  const found = INCLUDE.exec(line);
  return found ? (found[1] ?? found[2] ?? found[3] ?? null) : null;
}

/** How many changes are pending in a file's text, and the text of its newest view. */
export function summaryOf(text: string): { pending: number; newest: string } {
  const parsed = parse(text);
  const pending = parsed.marks.filter(isChange).length;
  return { pending, newest: newestView(text).text };
}

class IncludeWidget extends WidgetType {
  readonly path: string;
  readonly host: IncludeHost | null;

  constructor(path: string, host: IncludeHost | null) {
    super();
    this.path = path;
    this.host = host;
  }

  override eq(other: IncludeWidget): boolean {
    return other.path === this.path && other.host === this.host;
  }

  override get estimatedHeight(): number {
    return 36;
  }

  override toDOM(): HTMLElement {
    const { path, host } = this;
    const block = document.createElement('div');
    block.className = 'rl-include';
    block.setAttribute('role', 'group');
    block.setAttribute('aria-label', `Included file ${path}`);
    const head = document.createElement('div');
    head.className = 'rl-include-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rl-include-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', `Show ${path}`);
    toggle.textContent = '▸';
    const name = document.createElement('span');
    name.className = 'rl-include-name';
    name.textContent = path;
    const count = document.createElement('span');
    count.className = 'rl-include-count';
    head.append(toggle, name, count);
    const preview = document.createElement('div');
    preview.className = 'rl-include-preview';
    preview.hidden = true;
    block.append(head, preview);

    let loaded: Promise<void> | null = null;
    const load = (): Promise<void> => {
      if (!host) return Promise.resolve();
      loaded ??= host.read(path).then((text) => {
        if (text === null) {
          count.textContent = 'not found';
          preview.textContent = 'This file can’t be read.';
          return;
        }
        const { pending, newest } = summaryOf(text);
        count.textContent =
          pending === 0 ? '' : `${pending} ${pending === 1 ? 'change' : 'changes'} pending`;
        preview.textContent = newest.trim().replace(/\n{3,}/g, '\n\n');
      });
      return loaded;
    };
    if (host) {
      void load().catch(() => {
        count.textContent = 'not found';
      });
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'rl-include-open';
      open.textContent = 'Open';
      open.setAttribute('aria-label', `Open ${path}`);
      open.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (event.button === 0) host.open(path);
      });
      head.append(open);
      toggle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (event.button !== 0) return;
        const shown = preview.hidden;
        preview.hidden = !shown;
        toggle.setAttribute('aria-expanded', String(shown));
        toggle.textContent = shown ? '▾' : '▸';
        if (shown) void load();
      });
    } else {
      toggle.hidden = true;
    }
    return block;
  }

  override ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('button') !== null;
  }
}

/** The blocks of the includes in `state`; none outside a pandoc file or in Plain. */
export function includeDecorations(state: EditorState): DecorationSet {
  if (state.facet(dialectFacet) !== 'pandoc') return Decoration.none;
  if (state.field(viewModeField, false) === 'raw') return Decoration.none;
  const { doc } = state;
  if (!doc.sliceString(0).includes('{{<')) return Decoration.none;
  const host = state.facet(includeFacet);
  const ranges: Range<Decoration>[] = [];
  let code: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      continue;
    }
    const path = includePath(line.text);
    if (path === null) continue;
    if (state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from)) continue;
    ranges.push(
      Decoration.replace({ widget: new IncludeWidget(path, host), block: true }).range(
        line.from,
        line.to,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<DecorationSet>({
  create: (state) => includeDecorations(state),
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.startState.facet(dialectFacet) !== tr.state.facet(dialectFacet) ||
    tr.startState.facet(includeFacet) !== tr.state.facet(includeFacet) ||
    tr.startState.field(viewModeField, false) !== tr.state.field(viewModeField, false)
      ? includeDecorations(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

/** The block, in the grays of the rest of the review chrome. */
const theme = EditorView.baseTheme({
  '.rl-include': {
    margin: '6px 0',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-tint)',
    color: 'var(--rl-ink)',
    fontSize: 'var(--rl-size-ui-scaled)',
  },
  '.rl-include-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
  },
  '.rl-include-toggle, .rl-include-open': {
    border: 'none',
    background: 'transparent',
    color: 'var(--rl-ink-2)',
    font: 'inherit',
    cursor: 'pointer',
    borderRadius: '4px',
    padding: '0 6px',
  },
  '.rl-include-toggle:hover, .rl-include-open:hover': {
    color: 'var(--rl-ink)',
    backgroundColor: 'var(--rl-rule)',
  },
  '.rl-include-toggle:focus-visible, .rl-include-open:focus-visible': {
    outline: '2px solid var(--rl-ink-3)',
    outlineOffset: '1px',
  },
  '.rl-include-name': {
    fontFamily: 'var(--rl-font-mono)',
    fontWeight: '600',
    flex: '1',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.rl-include-count': { color: 'var(--rl-ink-2)', fontSize: 'var(--rl-size-ui-small-scaled)' },
  '.rl-include-preview': {
    margin: '0 10px 8px',
    padding: '8px 0 0',
    borderTop: '1px solid var(--rl-rule)',
    maxHeight: '320px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    color: 'var(--rl-ink-2)',
    userSelect: 'text',
  },
});

/** Includes drawn as collapsed blocks in a pandoc file. */
export function quartoIncludes(): Extension {
  return [field, theme];
}
