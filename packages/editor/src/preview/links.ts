// Opening a link (design §5.2): a ⌘-click on a link, which the preview draws (`rl-link`), opens its
// address through the host, and a pointer at rest on one says so, after the pause the title bar's
// hints make. A plain click keeps placing the caret, so link text stays easy to edit.
//
// Only web and mail addresses open: `http`, `https` and `mailto`, as the copy of a selection turns
// `javascript:` and its kin into plain text (clipboard/copy-html.ts). A link that doesn't open is
// left to the editor like any text: nothing is taken, nothing is promised.

import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  EditorView,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { destination } from '../clipboard/copy-html.ts';

/** What an address has after its scheme: no white space or control character. */
const REST = '[^\\s\\u0000-\\u001f\\u007f-\\u009f]+';
const ADDRESS = new RegExp(`^(?:https?://|mailto:)${REST}$`, 'i');
const WWW = new RegExp(`^www\\.${REST}$`, 'i');

/**
 * The address to open for a link's destination, or null when it isn't one the page may open: only
 * `http`, `https` and `mailto`, with something after the scheme and no white space. A `www.`
 * address is the web's, as GitHub's autolinks make it (`http://`). Anything else, `javascript:`,
 * `data:`, `file:`, another scheme, and a link to another document, is null.
 */
export function openableAddress(href: string): string | null {
  const address = href.trim();
  if (ADDRESS.test(address)) return address;
  return WWW.test(address) ? `http://${address}` : null;
}

/** A reference label as definitions and uses agree on it. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** The destination that the definition of `label` gives, or null where nothing defines it. */
function definition(state: EditorState, label: string): string | null {
  const wanted = labelKey(label);
  let found: string | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (found !== null) return false;
      if (node.name !== 'LinkReference') return true;
      const labelNode = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (
        labelNode &&
        url &&
        labelKey(state.sliceDoc(labelNode.from + 1, labelNode.to - 1)) === wanted
      ) {
        found = destination(state.sliceDoc(url.from, url.to));
      }
      return false;
    },
  });
  return found;
}

/** The destination of a `Link` node: its own, or the one its reference label gives. */
function linkOf(state: EditorState, node: SyntaxNode): string | null {
  const [open, close] = node.getChildren('LinkMark');
  if (!open || !close) return null;
  // The destination or the label comes after the closing bracket of the text, which may hold an
  // address of its own (`[www.example.org](https://…)`).
  const after = (child: SyntaxNode) => child.from >= close.to;
  const url = node.getChildren('URL').find(after);
  if (url) return destination(state.sliceDoc(url.from, url.to));
  const label = node.getChildren('LinkLabel').find(after);
  if (!label) return null;
  const written = state.sliceDoc(label.from + 1, label.to - 1);
  // `[text][]` is defined by its own text.
  return definition(state, written.trim() !== '' ? written : state.sliceDoc(open.to, close.from));
}

/**
 * The destination of the link whose text holds `pos`, as the Markdown reader has it (unescaped, its
 * entities decoded, without the angle brackets): of an inline link, a reference link, an autolink
 * or a bare address. Null outside a link, in an image, and for a reference nothing defines.
 *
 * A bare address (`www.example.org`, `ada@example.org`, `https://…`) written in the text of a link
 * is no link inside it: the reader makes none there, and what the link opens is its own destination.
 */
export function linkDestination(state: EditorState, pos: number): string | null {
  let bare: SyntaxNode | null = null;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === 'Image') return null;
    if (node.name === 'Link') {
      // A bracketed phrase with no destination, or a reference nothing defines, is text: an
      // address in it is a bare address.
      const to = linkOf(state, node);
      if (to !== null) return to;
    }
    if (node.name === 'Autolink') {
      const url = node.getChild('URL');
      return url ? destination(state.sliceDoc(url.from, url.to)) : null;
    }
    // The climb goes on, to a link around it if there is one.
    if (node.name === 'URL' && !bare && node.parent?.name !== 'Autolink') bare = node;
  }
  return bare ? destination(state.sliceDoc(bare.from, bare.to)) : null;
}

/** A link under the pointer: the drawn element, where its text starts, and the address it opens. */
interface Hovered {
  element: HTMLElement;
  pos: number;
  address: string;
}

/** The drawn link under `target`, if the editor's content holds it. */
function linkElement(view: EditorView, target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('.rl-link') : null;
  return element && view.contentDOM.contains(element) ? element : null;
}

/** The link that a drawn element is, if it is one that opens. */
function linkAt(view: EditorView, element: HTMLElement): Hovered | null {
  let pos: number;
  try {
    pos = view.posAtDOM(element, 0);
  } catch {
    // Not part of the text: an element of a widget.
    return null;
  }
  const href = linkDestination(view.state, pos);
  const address = href === null ? null : openableAddress(href);
  return address === null ? null : { element, pos, address };
}

function linkUnder(view: EditorView, target: EventTarget | null): Hovered | null {
  const element = linkElement(view, target);
  return element ? linkAt(view, element) : null;
}

/** What the extension needs of the host and the page. */
export interface LinkOpeningOptions {
  /** Opens an address, which is `http`, `https` or `mailto`, in the host's browser or mail app. */
  open(address: string): void;
  /** How long the pointer rests on a link before its hint shows, in ms. Default: 400 (the title bar's). */
  hintDelay?: number;
  /** Whether the key that opens is ⌘ (the Mac's) or Ctrl. Default: ⌘ on a Mac, Ctrl elsewhere. */
  command?: boolean;
}

/** The farthest the pointer may move between pressing and releasing for the press to be a click. */
const CLICK_SLOP = 4;

/** How the key that opens is named in the hint: "⌘-click" or "Ctrl-click". */
const clickName = Facet.define<string, string>({ combine: (values) => values[0] ?? '⌘-click' });

const setHint = StateEffect.define<Hovered | null>();

const setReady = StateEffect.define<boolean>();

const READY: Record<string, string> = { class: 'rl-link-ready' };
const NOT_READY: Record<string, string> = {};

/**
 * Whether the pointer is on a link that opens with the key that opens down. The content says so by a
 * class, and the theme makes it a pointer: CodeMirror keeps the attributes of its content, and takes
 * away what is set by hand on its elements at its next update, the hint's own among them.
 */
const readyField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setReady));
    if (set) return set.value;
    // The text moved: the link under the pointer may be gone.
    return tr.docChanged ? false : value;
  },
  provide: (field) =>
    EditorView.contentAttributes.from(field, (ready) => (ready ? READY : NOT_READY)),
});

/** The link the hint is for, shown after the pause. */
interface Hint {
  pos: number;
  address: string;
}

const hintField = StateField.define<Hint | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.findLast((effect) => effect.is(setHint));
    if (set) return set.value ? { pos: set.value.pos, address: set.value.address } : null;
    // The text moved: the link may be gone, or elsewhere.
    return tr.docChanged ? null : value;
  },
  provide: (field) =>
    showTooltip.compute([field, clickName], (state): Tooltip | null => {
      const hint = state.field(field);
      if (!hint) return null;
      const click = state.facet(clickName);
      return {
        pos: hint.pos,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'rl-link-hint';
          dom.setAttribute('aria-hidden', 'true');
          const what = document.createElement('span');
          what.className = 'rl-link-hint-do';
          what.textContent = `${click} to open`;
          const address = document.createElement('span');
          address.className = 'rl-link-hint-address';
          address.textContent = hint.address;
          dom.append(what, address);
          return { dom };
        },
      };
    }),
});

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * ⌘-click on a link opens it, and a pointer at rest on one shows a hint, in the interface's hint
 * style, after the title bar's pause. With ⌘ held, the pointer over a link is a pointer.
 */
export function linkOpening(options: LinkOpeningOptions): Extension {
  const delay = options.hintDelay ?? 400;
  const command = options.command ?? isMac();
  /** The key that opens, as a keyboard event names it. */
  const keyName = command ? 'Meta' : 'Control';
  /** Whether the key that opens is down, and no other that would make it another click. */
  const isOpening = (event: MouseEvent) =>
    command
      ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  const plugin = ViewPlugin.fromClass(
    class {
      /** The press that landed on a link that opens, and may become a click. */
      private press: { x: number; y: number; hovered: Hovered; doc: Text } | null = null;
      /** The link the pointer is on, which opens. */
      private over: Hovered | null = null;
      /** Whether the key that opens is down. */
      private held = false;
      private timer: ReturnType<typeof setTimeout> | undefined;
      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        const { scrollDOM } = view;
        // The press is taken before the editor's own handler sees it, so that it places no caret,
        // adds no cursor and starts no selection.
        scrollDOM.addEventListener('mousedown', this.down, true);
        scrollDOM.addEventListener('mousemove', this.move);
        scrollDOM.addEventListener('mouseleave', this.leave);
        const page = view.dom.ownerDocument;
        page.addEventListener('mouseup', this.up, true);
        // Whatever scrolls moves the link from under the pointer, which sends no event of its own.
        page.addEventListener('scroll', this.leave, true);
        page.defaultView?.addEventListener('keydown', this.key);
        page.defaultView?.addEventListener('keyup', this.key);
        page.defaultView?.addEventListener('blur', this.blur);
      }

      update(update: ViewUpdate): void {
        // The text moved: the field has let go of the hint, and the link under the pointer may
        // not be there.
        if (update.docChanged) this.release();
      }

      destroy(): void {
        const { scrollDOM } = this.view;
        scrollDOM.removeEventListener('mousedown', this.down, true);
        scrollDOM.removeEventListener('mousemove', this.move);
        scrollDOM.removeEventListener('mouseleave', this.leave);
        const page = this.view.dom.ownerDocument;
        page.removeEventListener('mouseup', this.up, true);
        page.removeEventListener('scroll', this.leave, true);
        page.defaultView?.removeEventListener('keydown', this.key);
        page.defaultView?.removeEventListener('keyup', this.key);
        page.defaultView?.removeEventListener('blur', this.blur);
        clearTimeout(this.timer);
      }

      private readonly down = (event: MouseEvent) => {
        this.press = null;
        // Any press puts the hint away, as it does a tooltip.
        this.forget();
        if (event.button !== 0 || !isOpening(event)) return;
        const hovered = linkUnder(this.view, event.target);
        if (!hovered) return;
        // Taken whole: no caret, no cursor added, no selection.
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) return;
        this.press = { x: event.clientX, y: event.clientY, hovered, doc: this.view.state.doc };
      };

      private readonly up = (event: MouseEvent) => {
        const { press } = this;
        this.press = null;
        if (!press) return;
        event.preventDefault();
        event.stopPropagation();
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_SLOP) return;
        // The text changed since the press: the link under it may be another.
        if (this.view.state.doc !== press.doc) return;
        try {
          options.open(press.hovered.address);
        } catch (error) {
          // The host says what went wrong, if it has anything to say.
          console.warn('Could not open the link', error);
        }
      };

      private readonly move = (event: MouseEvent) => {
        if (this.press) return;
        this.held = isOpening(event);
        const element = linkElement(this.view, event.target);
        // Moving on within the link it is on: nothing to work out again.
        if (element && element === this.over?.element) return this.sync(false);
        const hovered = element ? linkAt(this.view, element) : null;
        if (!hovered) return this.forget();
        this.release();
        this.over = hovered;
        // The hint comes after the usual pause.
        this.timer = setTimeout(() => {
          if (this.over?.element === hovered.element) {
            this.view.dispatch({ effects: setHint.of(hovered) });
          }
        }, delay);
        this.sync(true);
      };

      private readonly leave = () => this.forget();

      /** The key that opens pressed or let go with the pointer at rest: the pointer follows. */
      private readonly key = (event: KeyboardEvent) => {
        if (event.key !== keyName) return;
        this.held = event.type === 'keydown';
        this.sync(false);
      };

      private readonly blur = () => {
        this.held = false;
        this.sync(false);
      };

      /** Lets go of the link under the pointer, without a transaction: for an update to call. */
      private release(): void {
        clearTimeout(this.timer);
        this.over = null;
      }

      /** The pointer is no longer on a link that opens. */
      private forget(): void {
        this.release();
        this.sync(true);
      }

      /**
       * Brings the editor's state to what the pointer is doing: the hint away when asked, and the
       * look of a pointer over a link that opens while the key that opens is down.
       */
      private sync(dropHint: boolean): void {
        const { state } = this.view;
        const effects: StateEffect<unknown>[] = [];
        if (dropHint && state.field(hintField, false)) effects.push(setHint.of(null));
        const ready = this.held && this.over !== null;
        if (state.field(readyField, false) !== ready) effects.push(setReady.of(ready));
        if (effects.length > 0) this.view.dispatch({ effects });
      }
    },
  );
  return [
    plugin,
    hintField,
    readyField,
    clickName.of(command ? '⌘-click' : 'Ctrl-click'),
    linkTheme,
  ];
}

const linkTheme = EditorView.baseTheme({
  '.rl-link-hint': {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '7px 10px',
    maxWidth: 'min(32rem, 90vw)',
    borderRadius: '8px',
    backgroundColor: 'var(--rl-tip)',
    color: '#ffffff',
    fontSize: 'var(--rl-size-ui-small)',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  '.rl-link-hint-do': { flex: 'none' },
  '.rl-link-hint-address': {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'rgb(255 255 255 / 0.62)',
  },
  // A tooltip of CodeMirror's draws no frame of its own here.
  '.cm-tooltip:has(> .rl-link-hint)': { border: 'none', backgroundColor: 'transparent' },
  // With the key that opens down, a link that opens is a pointer.
  '.cm-content.rl-link-ready .rl-link': { cursor: 'pointer' },
});
