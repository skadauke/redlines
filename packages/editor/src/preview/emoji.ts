// Emoji shortcodes in the preview (#312, design §5.2). A `:name:` that the host knows is drawn as its
// emoji, as an entity is drawn as its character: in every view but Raw, as written while the caret is
// on it, and left alone in code, in a link's address and in a code block. The editor has no list of
// names, which would weigh on every host: a host gives a `lookup`, and without one the text stays as
// it is. What is written is the emoji itself (the autocomplete of the emoji plugin writes the
// character); a shortcode already in a file is kept as written.
//
// GitHub shows a shortcode as written where a letter or a digit stands against its start, and the
// preview does the same: `a:tent:` is text, and so is the one a marker would otherwise make an emoji
// (format §3.1, rule 9).

import { Facet, type EditorState } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import { shortcodeAt } from '@redlines/format';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/** The emoji for a shortcode's name (`tent` for `:tent:`), or undefined for a name not known. */
export type EmojiLookup = (name: string) => string | undefined;

/** What a host knows of emoji names. The first lookup that has a name answers for it. */
export const emojiLookup = Facet.define<EmojiLookup, EmojiLookup>({
  combine: (lookups) => (name) => {
    for (const lookup of lookups) {
      const found = lookup(name);
      if (found !== undefined) return found;
    }
    return undefined;
  },
});

/**
 * Shortcodes as `Emoji` nodes of the parse, wherever one stands in running text. Which of them are
 * emoji is the host's to say: a node is only a shape that could be one.
 */
export const emojiCodes: MarkdownConfig = {
  defineNodes: [{ name: 'Emoji', style: tags.character }],
  parseInline: [
    {
      name: 'Emoji',
      parse(cx, next, pos) {
        if (next !== 58 /* ':' */) return -1;
        const code = shortcodeAt(cx.slice(pos, pos + 80));
        if (code === null) return -1;
        // A letter or a digit against its start: GitHub shows it as written.
        if (pos > cx.offset && /[\p{L}\p{N}]/u.test(cx.slice(pos - 1, pos))) return -1;
        return cx.addElement(cx.elt('Emoji', pos, pos + code.length));
      },
    },
  ],
};

/** A shortcode drawn as its emoji. */
class EmojiWidget extends WidgetType {
  readonly char: string;
  readonly name: string;

  constructor(char: string, name: string) {
    super();
    this.char = char;
    this.name = name;
  }

  override eq(other: EmojiWidget): boolean {
    return other.char === this.char && other.name === this.name;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'rl-emoji';
    span.setAttribute('role', 'img');
    // The name as it is said: its words, with the `_` and `-` between them taken out (`-1` stays).
    span.setAttribute('aria-label', this.name.replace(/(?<=[a-z0-9])[_-](?=[a-z0-9])/g, ' '));
    span.textContent = this.char;
    return span;
  }

  /** Clicking the emoji puts the caret on it, which shows its shortcode. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The decoration that draws an `Emoji` node as its emoji, or null for a name the host doesn't know. */
export function emojiDecoration(state: EditorState, from: number, to: number): Decoration | null {
  const name = state.sliceDoc(from + 1, to - 1);
  const char = state.facet(emojiLookup)(name);
  return char === undefined ? null : Decoration.replace({ widget: new EmojiWidget(char, name) });
}
