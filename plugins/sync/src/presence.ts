// What the other windows of a session show in this one: each one's caret, with a flag that names it
// and fades after a few seconds, and its selection, tinted; while a selection lasts, its caret and
// flag stay, so that it is clear who marked what (#1168). Positions arrive as the sender kept
// them (in the confirmed text at a version) and are placed in what this window shows; between two
// messages they move with the text, as any position does. A person's color is their author color in
// this document (`--rl-author-<n>`, as their changes are drawn), the same in every window of theirs
// and never shared with another person here.

import { StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

/** One other window, as this one shows it. */
export interface PeerView {
  clientID: string;
  name: string;
  /** The person's author color in this document, 1 to 8 (`colorsOf`); 0 for gray. */
  color: number;
  head: number;
  anchor: number;
  /** When it last moved, in ms: the flag shows for a few seconds after. */
  stamp: number;
}

/** How long a flag shows after its window last moved. */
export const FLAG_MS = 5000;

export const STYLE_ID = 'rl-sync-style';

export const STYLE = `
.rl-presence-caret {
  position: relative;
  display: inline-block;
  width: 0;
  height: 1.15em;
  margin: 0 -1px;
  border-left: 2px solid var(--rl-presence-color);
  vertical-align: text-bottom;
  pointer-events: none;
}
.rl-presence-flag {
  position: absolute;
  bottom: 100%;
  left: -2px;
  padding: 1px 6px;
  border-radius: 4px 4px 4px 0;
  background: var(--rl-presence-color);
  color: var(--rl-page);
  font-family: var(--rl-font-ui);
  font-size: var(--rl-size-ui-small);
  font-style: normal;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  opacity: 0;
  animation: rl-presence-flag ${FLAG_MS}ms ease-out;
  pointer-events: none;
}
.rl-presence-flag-stays {
  opacity: 1;
  animation: none;
}
@keyframes rl-presence-flag {
  0%,
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.rl-presence-selection {
  background: color-mix(in srgb, var(--rl-presence-color) 22%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .rl-presence-flag {
    animation-duration: 1ms;
    animation-fill-mode: forwards;
    opacity: 1;
  }
}
`;

/** The author color as the value the rules above read. */
const colorVar = (color: number): string =>
  color >= 1 && color <= 8 ? `var(--rl-author-${color})` : 'var(--rl-ink-2)';

class Caret extends WidgetType {
  readonly #peer: PeerView;
  constructor(peer: PeerView) {
    super();
    this.#peer = peer;
  }
  override eq(other: Caret): boolean {
    const a = this.#peer;
    const b = other.#peer;
    return (
      a.clientID === b.clientID &&
      a.name === b.name &&
      a.color === b.color &&
      a.stamp === b.stamp &&
      a.head === b.head &&
      (a.head === a.anchor) === (b.head === b.anchor)
    );
  }
  override toDOM(): HTMLElement {
    const caret = document.createElement('span');
    caret.className = 'rl-presence-caret';
    caret.style.setProperty('--rl-presence-color', colorVar(this.#peer.color));
    caret.dataset['peer'] = this.#peer.clientID;
    caret.setAttribute('aria-hidden', 'true');
    // Not for a window that moved long ago: the caret stays, the name has gone. With a selection
    // the name stays too, for as long as the selection lasts.
    const selecting = this.#peer.head !== this.#peer.anchor;
    if (selecting || Date.now() - this.#peer.stamp < FLAG_MS) {
      const flag = document.createElement('span');
      flag.className = selecting ? 'rl-presence-flag rl-presence-flag-stays' : 'rl-presence-flag';
      flag.textContent = this.#peer.name;
      caret.append(flag);
    }
    return caret;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const setPeers = StateEffect.define<readonly PeerView[]>();

interface Placed {
  peers: readonly PeerView[];
  decorations: DecorationSet;
}

function draw(peers: readonly PeerView[], length: number): DecorationSet {
  const ranges = [];
  for (const peer of peers) {
    const head = Math.min(Math.max(peer.head, 0), length);
    const anchor = Math.min(Math.max(peer.anchor, 0), length);
    const color = colorVar(peer.color);
    if (anchor !== head) {
      ranges.push(
        Decoration.mark({
          class: 'rl-presence-selection',
          attributes: { style: `--rl-presence-color: ${color}` },
        }).range(Math.min(head, anchor), Math.max(head, anchor)),
      );
    }
    ranges.push(Decoration.widget({ widget: new Caret(peer), side: 1 }).range(head));
  }
  return Decoration.set(ranges, true);
}

const field = StateField.define<Placed>({
  create: () => ({ peers: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPeers)) {
        return { peers: effect.value, decorations: draw(effect.value, tr.newDoc.length) };
      }
    }
    if (!tr.docChanged || !value.peers.length) return value;
    // The text moved under them: so do the carets, until the next message places them again.
    const peers = value.peers.map((peer) => ({
      ...peer,
      head: tr.changes.mapPos(peer.head, -1),
      anchor: tr.changes.mapPos(peer.anchor, -1),
    }));
    return { peers, decorations: draw(peers, tr.newDoc.length) };
  },
  provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
});

/** The extension that draws other windows' carets and selections. */
export function presenceExtension(): Extension {
  return field;
}

/** Puts these windows' carets and selections in the view. */
export function showPeers(view: EditorView, peers: readonly PeerView[]): void {
  view.dispatch({ effects: setPeers.of(peers) });
}

/** The windows shown now, with the positions the view moved them to. */
export function peersShown(view: EditorView): readonly PeerView[] {
  return view.state.field(field).peers;
}

/** Puts the style sheet in the page, once. */
export function ensureStyle(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.append(style);
}
