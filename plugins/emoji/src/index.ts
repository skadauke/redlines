// Emoji shortcodes (#312): the ones already in a file are drawn as their emoji in every view but
// Raw (the editor draws them, from the names this plugin gives it), and typing `:` and two letters
// lists matching emoji, which are written as the character itself. Preferences can turn the list
// off; the shortcodes in a file are drawn either way.

import { emojiLookup, type Editor } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { emojiFor } from './lookup.ts';
import { suggestExtensions, type SuggestOptions } from './suggest.ts';

export { emojiFor, emojiMatches, type EmojiName } from './lookup.ts';
export { suggestExtensions, triggerAt, type SuggestOptions, type Trigger } from './suggest.ts';

/**
 * Starts the emoji: the names the editor draws shortcodes by, and the list after a colon. Returns a
 * function that takes them out again.
 */
export function createEmoji(editor: Editor, options: SuggestOptions = {}): () => void {
  const remove = editor.addExtension([emojiLookup.of(emojiFor), suggestExtensions(options)]);
  return remove;
}

export const plugin: Plugin = {
  manifest: {
    id: 'redlines.emoji',
    name: 'Emoji',
    version: '0.0.0',
    needs: ['document:read', 'document:edit'],
  },
  activate: (context) => createEmoji(context.editor as Editor),
};
