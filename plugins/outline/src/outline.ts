// The outline (design §6.4): an animated outline of the document's headings in the left margin. At
// rest it is a column of short lines, one for each heading, longer for the higher levels, with the
// line of the section being read in ink; with the pointer on it, or the focus in it, it opens into a
// list of the headings' text; a click on one goes to it, and when the pointer leaves it closes.
//
// It stands in the pane the editor scrolls in, at its left edge, and not in the editor, so that it
// stays where it is as the text scrolls, and moves with the pane when the file sidebar opens. Only
// its panel takes pointer events: the margin beside it holds the change bars, whose clicks it must
// not take, and it shows its lines only where the margin has room for them beside the bars. Its list
// is always in the page, for a screen reader and for the keyboard: ⌃⌘O puts the focus in it, the
// arrows move between headings, Return goes to one and Escape gives the focus back to the text.

import { syntaxTree } from '@codemirror/language';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Editor } from '@redlines/editor';
import { type Heading, headingsOf } from './headings.ts';
import { STYLE, STYLE_ID } from './styles.ts';

/** Where the editor's pane is, which the outline is placed by. */
export interface PaneBox {
  /** The element that holds the outline: the pane's parent, which the outline is positioned in. */
  host: HTMLElement;
  /** The pane's left and top in `host`, and its height, in px. */
  left: number;
  top: number;
  height: number;
  /** How far in from the pane's left edge the text starts, in px. */
  textLeft: number;
  /** Whether the page has been scrolled down at all. */
  scrolled: boolean;
  /** Whether it can go no further down: also true of a page that fits, and is not scrolled. */
  atEnd: boolean;
}

/** What the outline asks the page's layout; the tests stand in for it, as happy-dom lays out nothing. */
export interface OutlineGeometry {
  /** The pane that scrolls the editor, or null when it has none. */
  pane(view: EditorView): PaneBox | null;
  /** How far below the top of the pane the line at `pos` is, in px; negative above it. */
  lineTop(view: EditorView, pos: number): number;
}

export interface OutlineOptions {
  geometry?: OutlineGeometry;
  /** Says a short word to the person, as when the outline has too few headings to show. */
  notice?: (message: string) => void;
}

/** How long after the text changes the headings are read again: not at each keystroke. */
const REFRESH_MS = 250;
/** How long after a scroll or a resize the reading place and the placing are worked out again. */
const LOCATE_MS = 40;
/** The pause before the pointer opens the list, and before it closes after the pointer leaves. */
const OPEN_MS = 70;
const CLOSE_MS = 160;
/** A heading is the section being read once its line is this far below the top of the pane or above. */
const READING_LINE = 80;
/** Fewer headings than this are not worth an outline. */
const MIN_HEADINGS = 2;
/** What the command says when there are fewer. */
const TOO_FEW = 'The outline needs a document with two headings.';
/** The room the lines need in the margin: the change bars' reach, the strip, and a gap. */
const BAR_REACH = 36;
const STRIP = 38;
const ROOM = BAR_REACH + STRIP + 6;

/** The nearest ancestor of the editor that scrolls, as in the app, where the page scrolls in an
 * element around the editor; the editor's own scroller where nothing around it does. */
function paneOf(view: EditorView): HTMLElement {
  const win = view.dom.ownerDocument.defaultView ?? window;
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    if (/auto|scroll/.test(win.getComputedStyle(el).overflowY)) return el;
  }
  return view.scrollDOM;
}

/** The real layout. */
const pageGeometry: OutlineGeometry = {
  pane(view) {
    const pane = paneOf(view);
    const host = pane.parentElement;
    if (!host) return null;
    const paneRect = pane.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
    return {
      host,
      left: paneRect.left - hostRect.left,
      top: paneRect.top - hostRect.top,
      height: pane.clientHeight,
      textLeft: content.left + padding - paneRect.left,
      scrolled: pane.scrollTop > 2,
      atEnd: pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2,
    };
  },
  lineTop: (view, pos) =>
    view.documentTop + view.lineBlockAt(pos).top - paneOf(view).getBoundingClientRect().top,
};

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}

const element = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const made = doc.createElement(tag);
  made.className = className;
  return made;
};

/** Adds the outline to an editor, with its command, Show Outline (⌃⌘O) in the View menu. Returns a
 * function that takes it out again. */
export function createOutline(editor: Editor, options: OutlineOptions = {}): () => void {
  const geometry = options.geometry ?? pageGeometry;
  let instance: Outline | null = null;

  class Outline {
    private readonly view: EditorView;
    private readonly doc: Document;
    private readonly nav: HTMLElement;
    private readonly panel: HTMLElement;
    private readonly ticks: HTMLElement;
    private readonly list: HTMLOListElement;
    private headings: Heading[] = [];
    /** The heading of the section being read. */
    private current = 0;
    /**
     * The heading that was clicked, held as the one being read while the page can go no further, so
     * that it can't be brought to the reading line: until the page moves from its end, or the text
     * changes.
     */
    private pinned: number | null = null;
    private open = false;
    private hovered = false;
    private focusedIn = false;
    private host: HTMLElement | null = null;
    private readonly resizes: ResizeObserver | null;
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;
    private locateTimer: ReturnType<typeof setTimeout> | undefined;
    private openTimer: ReturnType<typeof setTimeout> | undefined;
    private closeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(view: EditorView) {
      this.view = view;
      this.doc = view.dom.ownerDocument;
      ensureStyle(this.doc);
      this.nav = element(this.doc, 'nav', 'rl-outline');
      this.nav.setAttribute('aria-label', 'Outline');
      this.nav.dataset['open'] = 'false';
      this.nav.dataset['ticks'] = 'true';
      this.nav.style.pointerEvents = 'none';
      this.panel = element(this.doc, 'div', 'rl-outline-panel');
      this.panel.style.pointerEvents = 'auto';
      this.ticks = element(this.doc, 'div', 'rl-outline-ticks');
      this.ticks.setAttribute('aria-hidden', 'true');
      this.list = element(this.doc, 'ol', 'rl-outline-list');
      this.panel.append(this.ticks, this.list);
      this.nav.append(this.panel);

      this.panel.addEventListener('mouseenter', this.enter);
      this.panel.addEventListener('mouseleave', this.leave);
      this.nav.addEventListener('focusin', this.focusIn);
      this.nav.addEventListener('focusout', this.focusOut);
      this.list.addEventListener('keydown', this.keys);
      // A scroll doesn't bubble: whatever scrolls is heard by the capture, and the window's size
      // and the sidebar's width change the pane.
      this.doc.addEventListener('scroll', this.locateSoon, true);
      this.doc.defaultView?.addEventListener('resize', this.locateSoon);
      // The file sidebar opening, or any change to the pane, moves it without a resize of the window.
      this.resizes =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.locateSoon());

      this.headings = headingsOf(view.state);
      this.render();
      this.locate();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        // Until the headings are read again, where each is, so that a click goes to the right line.
        this.pinned = null;
        this.headings = this.headings.map((heading) => ({
          ...heading,
          from: update.changes.mapPos(heading.from),
        }));
        this.refreshSoon();
      } else if (syntaxTree(update.startState) !== syntaxTree(update.state)) {
        // A parse that went further brings headings the first did not reach.
        this.refreshSoon();
      }
      if (update.geometryChanged || update.heightChanged) this.locateSoon();
    }

    destroy(): void {
      clearTimeout(this.refreshTimer);
      clearTimeout(this.locateTimer);
      clearTimeout(this.openTimer);
      clearTimeout(this.closeTimer);
      this.doc.removeEventListener('scroll', this.locateSoon, true);
      this.doc.defaultView?.removeEventListener('resize', this.locateSoon);
      this.resizes?.disconnect();
      this.nav.remove();
    }

    /** Puts the focus on the heading being read, with the list open. False where there is no outline. */
    focusCurrent(): boolean {
      if (this.nav.hidden) return false;
      this.locate();
      this.setOpen(true);
      this.focusItem(this.current);
      return true;
    }

    private readonly refreshSoon = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.headings = headingsOf(this.view.state);
        this.render();
        this.locate();
      }, REFRESH_MS);
    };

    /**
     * Works out the placing and the section being read, at most once in a while: a scroll sends
     * events all the way, and a pause after the last would be after it was over. What scrolls in the
     * outline itself is the person's, and leaves the reading place alone.
     */
    private readonly locateSoon = (event?: Event) => {
      if (event?.target instanceof Node && this.nav.contains(event.target)) return;
      if (this.locateTimer !== undefined) return;
      this.locateTimer = setTimeout(() => {
        this.locateTimer = undefined;
        this.locate();
      }, LOCATE_MS);
    };

    /** Draws the lines and the list, or hides the outline when there is too little to outline. */
    private render(): void {
      const buttons = this.items();
      const hadFocus = buttons.findIndex((button) => button === this.doc.activeElement);
      this.nav.hidden = this.headings.length < MIN_HEADINGS;
      this.ticks.replaceChildren(
        ...this.headings.map(({ level }) => {
          const tick = element(this.doc, 'span', 'rl-outline-tick');
          tick.dataset['level'] = String(level);
          return tick;
        }),
      );
      this.list.replaceChildren(
        ...this.headings.map((heading, i) => {
          const item = element(this.doc, 'li', 'rl-outline-entry');
          const button = element(this.doc, 'button', 'rl-outline-item');
          button.type = 'button';
          button.textContent = heading.text;
          button.dataset['level'] = String(heading.level);
          button.style.setProperty('--rl-outline-level', String(heading.level));
          button.addEventListener('click', () => this.go(i));
          item.append(button);
          return item;
        }),
      );
      this.current = Math.min(this.current, Math.max(0, this.headings.length - 1));
      this.mark(this.current);
      this.reveal();
      // The list was drawn again under the focus, which stays on the same heading.
      if (hadFocus >= 0 && !this.nav.hidden)
        this.focusItem(Math.min(hadFocus, this.headings.length - 1));
    }

    private items(): HTMLButtonElement[] {
      return [...this.list.querySelectorAll<HTMLButtonElement>('button')];
    }

    /** Where the outline stands, whether its lines have room, and which section is being read. */
    private locate(): void {
      const pane = geometry.pane(this.view);
      if (pane) {
        if (this.host !== pane.host) {
          this.host = pane.host;
          pane.host.append(this.nav);
          this.resizes?.disconnect();
          this.resizes?.observe(pane.host);
        }
        this.nav.style.left = `${pane.left}px`;
        this.nav.style.top = `${pane.top}px`;
        this.nav.style.height = `${pane.height}px`;
        this.nav.dataset['ticks'] = String(pane.textLeft >= ROOM);
        this.reach();
      }
      // The last heading whose line is at or above the reading line; the first before any is.
      let found = this.lastAbove(READING_LINE);
      if (pane?.atEnd) {
        // The page can go no further, so a heading below the reading line can't be brought to it:
        // the one that was clicked is the one being read, and after a scroll to the end the last
        // one in view is.
        const inView = this.lastAbove(pane.height - 1);
        if (this.pinned !== null && this.pinned <= inView) found = this.pinned;
        else if (pane.scrolled) found = Math.max(found, inView);
      }
      if (!pane?.atEnd || (this.pinned !== null && this.pinned <= found && found !== this.pinned)) {
        this.pinned = null;
      }
      const changed = found !== this.current;
      this.current = found;
      this.mark(found);
      if (changed) this.reveal();
    }

    /** The last heading whose line is at or above `line`, px from the pane's top; the first if none. */
    private lastAbove(line: number): number {
      let found = 0;
      let low = 0;
      let high = this.headings.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const heading = this.headings[middle] as Heading;
        if (geometry.lineTop(this.view, heading.from) <= line) {
          found = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      return found;
    }

    /** Marks the heading being read, in the lines and in the list, and makes it the list's tab stop. */
    private mark(index: number): void {
      [...this.ticks.children].forEach((tick, i) => {
        (tick as HTMLElement).dataset['current'] = String(i === index);
      });
      this.items().forEach((button, i) => {
        if (i === index) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
        button.tabIndex = i === index ? 0 : -1;
      });
    }

    private focusItem(index: number): void {
      const buttons = this.items();
      const button = buttons[Math.max(0, Math.min(index, buttons.length - 1))];
      if (!button) return;
      // One tab stop: the one that has the focus.
      buttons.forEach((other) => (other.tabIndex = other === button ? 0 : -1));
      button.focus();
    }

    private setOpen(open: boolean): void {
      this.open = open;
      this.nav.dataset['open'] = String(open);
      this.reach();
      if (open) this.reveal();
    }

    /**
     * Scrolls the panel, which may hold more lines than it shows, to the line of the section being
     * read at rest, or to its entry in the open list: into the middle of the panel.
     */
    private reveal(): void {
      const at = this.open ? this.list.children[this.current] : this.ticks.children[this.current];
      if (!(at instanceof HTMLElement)) return;
      this.panel.scrollTop = Math.max(0, at.offsetTop - this.panel.clientHeight / 2);
    }

    /** Where the lines are not shown, nothing at the margin's edge takes the pointer (the change bars
     * may be under it), unless the list is open: the keyboard opens it all the same. */
    private reach(): void {
      const idle = this.nav.dataset['ticks'] === 'false' && !this.open;
      this.panel.style.pointerEvents = idle ? 'none' : 'auto';
    }

    private scheduleClose(): void {
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => {
        if (!this.hovered && !this.focusedIn) this.setOpen(false);
      }, CLOSE_MS);
    }

    /** Goes to the heading: the caret at its line, the line at the top of the page, the focus in the text. */
    private go(index: number): void {
      const heading = this.headings[index];
      if (!heading) return;
      this.pinned = index;
      this.current = index;
      this.mark(index);
      this.view.dispatch({
        selection: { anchor: heading.from },
        effects: EditorView.scrollIntoView(heading.from, { y: 'start', yMargin: READING_LINE - 8 }),
        userEvent: 'select.outline',
      });
      this.view.focus();
      // Out of the way at once: the pointer that stays over it opens nothing until it comes again.
      clearTimeout(this.openTimer);
      this.setOpen(false);
    }

    private readonly enter = () => {
      this.hovered = true;
      clearTimeout(this.closeTimer);
      if (this.open) return;
      clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => this.setOpen(true), OPEN_MS);
    };

    private readonly leave = () => {
      this.hovered = false;
      clearTimeout(this.openTimer);
      this.scheduleClose();
    };

    private readonly focusIn = () => {
      this.focusedIn = true;
      clearTimeout(this.closeTimer);
      this.setOpen(true);
    };

    private readonly focusOut = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (to instanceof Node && this.nav.contains(to)) return;
      this.focusedIn = false;
      this.scheduleClose();
    };

    private readonly keys = (event: KeyboardEvent) => {
      const buttons = this.items();
      const at = buttons.findIndex((button) => button === this.doc.activeElement);
      const last = buttons.length - 1;
      let to: number | null = null;
      if (event.key === 'ArrowDown') to = Math.min(at + 1, last);
      else if (event.key === 'ArrowUp') to = Math.max(at - 1, 0);
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = last;
      else if (event.key === 'Escape') {
        event.preventDefault();
        this.setOpen(false);
        this.view.focus();
        return;
      }
      if (to === null) return;
      event.preventDefault();
      this.focusItem(to);
    };
  }

  const removeExtension = editor.addExtension(
    ViewPlugin.fromClass(
      class {
        private readonly outline: Outline;
        constructor(view: EditorView) {
          this.outline = new Outline(view);
          instance = this.outline;
        }
        update(update: ViewUpdate) {
          this.outline.update(update);
        }
        destroy() {
          this.outline.destroy();
          if (instance === this.outline) instance = null;
        }
      },
    ),
  );
  const removeCommands = editor.commands.register([
    {
      id: 'outline.focus',
      title: 'Show Outline',
      shortcut: 'Mod-Ctrl-o',
      menu: 'view',
      group: 'outline',
      runsInFields: true,
      run: () => {
        if (!instance) return false;
        if (instance.focusCurrent()) return true;
        // Nothing to show: a key that did nothing without a word would be no answer.
        options.notice?.(TOO_FEW);
        return options.notice !== undefined;
      },
    },
  ]);
  return () => {
    removeCommands();
    removeExtension();
  };
}
