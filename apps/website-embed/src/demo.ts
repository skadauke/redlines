// mountDemo: the editor with the review interface on the page, for the page's controls to drive.
// It does what `apps/desktop` does for a window (design §6.5), with no capability of a host: the
// demos keep nothing, so a half-written comment is gone with the page.

import { EditorView } from '@codemirror/view';
import { createEditor, type Author, type EditorUiState, type MetPerson } from '@redlines/editor';
import { createFormatting } from '@redlines/formatting';
import { createReview } from '@redlines/review';
import { applyTheme } from '@redlines/themes';
import type { DemoHandle, DemoOptions, DemoState, MountDemo } from './api.ts';
import { DOCS } from './docs.ts';
import { VIEWS } from './views.ts';

/** The visitor. */
export const VISITOR: Author = { handle: 'ada', name: 'Ada Lovelace' };

/**
 * The people the page draws in colors: Claude purple and Bo teal, as the fallback does. Without
 * this, `claude-ada` would lead to blue, and the swap at mount would recolor Claude's change.
 */
export const PEOPLE: readonly MetPerson[] = [
  { handle: 'claude-ada', color: 2 },
  { handle: 'bo', color: 3 },
];

const DARK = '(prefers-color-scheme: dark)';

export const mountDemo: MountDemo = (parent: HTMLElement, options: DemoOptions): DemoHandle => {
  const { file, text } = DOCS[options.demo];
  const onNotice = (message: string) => options.onNotice(message);

  // What the mount added, undone in reverse by `destroy`, and by a mount that throws.
  const undone: (() => void)[] = [];
  const undoAll = () => {
    for (const undo of undone.splice(0).reverse()) undo();
  };
  try {
    return mount();
  } catch (error) {
    undoAll();
    throw error;
  }

  function mount(): DemoHandle {
    const root = document.createElement('div');
    root.className = 'rl-embed';
    parent.append(root);
    undone.push(() => root.remove());

    const appearance = window.matchMedia(DARK);
    const theme = () => applyTheme(root, 'default', appearance.matches ? 'dark' : 'light');
    theme();
    appearance.addEventListener('change', theme);
    undone.push(() => appearance.removeEventListener('change', theme));

    let ui: EditorUiState | null = null;
    const tell = () => {
      if (!ui) return;
      const state: DemoState = {
        view: ui.view,
        views: VIEWS,
        tracking: ui.tracking,
        changes: ui.changes.length,
        canComment: ui.view !== 'raw',
        claudeRunning: false,
      };
      options.onState(state);
    };

    const editor = createEditor(root, {
      doc: text,
      author: VISITOR,
      view: 'redlines',
      tracking: true,
      typing: { smartPunctuation: true, spellCheck: false, closePairs: false },
      people: PEOPLE,
      extensions: [
        EditorView.contentAttributes.of({ 'aria-label': `Document: ${file}. An editable demo.` }),
      ],
      onUiState: (next) => {
        ui = next;
        tell();
      },
      onNotice,
    });
    undone.push(() => editor.destroy());
    ui = editor.getUiState();

    // Formatting before review, as the app does: Add Comment comes last in the Format menu.
    undone.push(createFormatting(editor, { author: VISITOR, notice: onNotice }));
    const review = createReview(editor, { author: VISITOR });
    undone.push(() => review.destroy());
    tell();

    let destroyed = false;
    return {
      setView: (view) => editor.setViewMode(view),
      setTracking: (on) => editor.setTracking(on),
      startComment: () => review.startComment(),
      // Task 15 makes it work for 'design'.
      askClaude: () => false,
      openReviewBar() {
        // The bar opens on the first change, with the focus on Accept, so that Tab and Return reach
        // Accept and Reject at once: the bar alone leaves them disabled. With the bar already open,
        // Review leaves the current change where it is.
        if (review.isBarOpen()) review.openBar();
        else if (ui && ui.changes.length > 0) review.next();
        else review.openBar();
        const bar = root.querySelector('.rl-review-bar');
        const buttons = [
          ...(bar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        // Named by its aria-label: the bar's text buttons also hold a hint for a narrow window.
        const target =
          buttons.find((each) => each.getAttribute('aria-label') === 'Accept') ?? buttons[0];
        target?.focus();
      },
      reset() {
        editor.setDoc(text);
        editor.setViewMode('redlines');
        editor.setTracking(true);
        tell();
      },
      getDoc: () => editor.getDoc(),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        undoAll();
      },
    };
  }
};
