// mountDemo: the editor with the review interface on the page, for the page's controls to drive.
// It does what `apps/desktop` does for a window (design §6.5), with no capability of a host: the
// demos keep nothing, so a half-written comment is gone with the page.

import { EditorView, keymap } from '@codemirror/view';
import {
  createEditor,
  undoDepth,
  type Author,
  type EditorUiState,
  type MetPerson,
} from '@redlines/editor';
import { createFormatting } from '@redlines/formatting';
import {
  attachPicker,
  createLiveLines,
  createRuns,
  renderCommentText,
  type LiveLines,
  type RunController,
} from '@redlines/agents';
import { createReview, type ReviewOptions } from '@redlines/review';
import { applyTheme } from '@redlines/themes';
import type { DemoHandle, DemoOptions, DemoState, MountDemo } from './api.ts';
import { CLAUDE, SAY, scriptedAgents } from './claude.ts';
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
const NOTHING_TO_UNDO = 'There is nothing to undo.';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** How long the scripted Claude takes for each step: less for a visitor who asks for less motion. */
const pause = () => (window.matchMedia(REDUCED_MOTION).matches ? 300 : 1000);

/** What the demo's agent panel adds to the review interface: the runs, and what draws them. */
type AgentWiring = Pick<ReviewOptions, 'onPosted' | 'attachToField' | 'extras'>;

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
    // The agent panel only: the runs of the scripted Claude, bound to this document.
    let runs: RunController | null = null;
    let liveLines: LiveLines | null = null;
    let stopQuietly: () => void = () => {};
    // Counts `reset()` calls: a run belongs to the document it was posted in.
    let generation = 0;
    const tell = () => {
      if (!ui) return;
      const state: DemoState = {
        view: ui.view,
        views: VIEWS,
        tracking: ui.tracking,
        changes: ui.changes.length,
        canComment: ui.view !== 'raw',
        claudeRunning: runs?.isLive() ?? false,
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
        // Reached only when the editor's own Undo did nothing and had no reason to give: the
        // visitor is told rather than left with a key that does nothing.
        keymap.of([
          {
            key: 'Mod-z',
            run: (view) => {
              if (undoDepth(view.state) > 0) return false;
              onNotice(NOTHING_TO_UNDO);
              return true;
            },
          },
        ]),
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
    const review = createReview(editor, {
      author: VISITOR,
      ...(options.demo === 'design' ? wireAgent() : {}),
    });
    undone.push(() => review.destroy());
    tell();

    /** The runs of the scripted Claude, their live lines, the @ picker and the notes' text. */
    function wireAgent(): AgentWiring {
      const agents = scriptedAgents({ pause });
      const created = createRuns({
        agents,
        author: VISITOR,
        // A document with no file: the run's tools act on the editor, and nothing is saved.
        document: {
          path: () => null,
          generation: () => generation,
          read: () => editor.getDoc(),
          save: () => Promise.resolve(true),
          applyAgentEdit: (next, agent) => {
            editor.reloadDoc(next, { agent: agent ?? null });
            return Promise.resolve();
          },
        },
        // With no path and a folder-limited agent these are never asked; they are here for the types.
        projectRoot: () => Promise.resolve({ folder: '/demo', isRepo: false, tooBroad: false }),
        settings: {
          defaultScope: () => 'document',
          consent: () => 'document',
          setConsent: () => {},
        },
        onEnded: () => {},
      });
      runs = created;
      undone.push(() => created.stopAll());
      liveLines = createLiveLines({
        runs: created,
        author: VISITOR,
        getParsed: () => editor.getParsed(),
        getMet: () => PEOPLE,
        refresh: (thread) => review.refreshThread(thread),
        showThread: (thread) => review.showThread(thread),
        focusDocument: () => editor.focus(),
      });
      // Each new status is told to the page once, for its live region, and so is the end of a
      // run: replied, stopped or refused, so that the region never rests on "Editing this section".
      let told: string | null = null;
      const stopHearing = created.subscribe((thread) => {
        const line = created.line(thread);
        if (line?.kind === 'running') {
          if (line.status !== told) {
            // The first status of a run opens the thread's note, so that its live line, Stop and
            // the reply are in sight without a click on its dot.
            if (told === null) review.showThread(thread);
            told = line.status;
            onNotice(`${CLAUDE.name}: ${line.status}`);
          }
        } else if (told !== null) {
          told = null;
          onNotice(
            line?.kind === 'failed'
              ? `${CLAUDE.name}: ${line.message}`
              : `${CLAUDE.name}: ${SAY.done}`,
          );
        }
        tell();
      });
      // A reset ends a run without a word: the document it was posted in is gone.
      stopQuietly = () => {
        told = null;
      };
      undone.push(stopHearing);
      return {
        onPosted: (comment) => created.posted(comment),
        attachToField: (field) =>
          attachPicker(field, {
            getParsed: () => editor.getParsed(),
            getMet: () => PEOPLE,
            me: VISITOR.handle,
            agents: () => [CLAUDE],
          }),
        extras: {
          renderText: (entry, person) =>
            renderCommentText(entry, person, {
              // A document with no file has no folder to cite from, so no citation is a link.
              documentPath: () => null,
              projectFolder: () => Promise.resolve(null),
              realPath: (path) => Promise.resolve(path),
              opensIn: () => 'none',
              open: () => {},
              openDefault: () => {},
              cannotOpen: () => {},
            }),
          footer: (thread) => liveLines?.footer(thread) ?? null,
          keepShown: (thread) => liveLines?.keepsShown(thread) ?? false,
        },
      };
    }

    let destroyed = false;
    return {
      setView: (view) => editor.setViewMode(view),
      setTracking: (on) => editor.setTracking(on),
      startComment: () => review.startComment(),
      askClaude() {
        if (options.demo !== 'design') return false;
        // The sentence the note is about, from "Uploads retry" to its "then fail.".
        const text = editor.view.state.doc.toString();
        const from = text.indexOf('Uploads retry');
        const end = from < 0 ? -1 : text.indexOf('then fail.', from);
        if (from >= 0 && end >= 0) {
          editor.view.dispatch({ selection: { anchor: from, head: end + 'then fail.'.length } });
        }
        return review.startComment(SAY.question);
      },
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
        const target = buttons.find((each) => each.textContent?.trim() === 'Accept') ?? buttons[0];
        target?.focus();
      },
      reset() {
        // A run posted before this finds another document: its tools refuse, and it stops.
        generation++;
        stopQuietly();
        runs?.documentReplaced();
        editor.setDoc(text);
        editor.setViewMode('redlines');
        editor.setTracking(true);
        tell();
      },
      getDoc: () => editor.getDoc(),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        runs?.stopAll();
        undoAll();
      },
    };
  }
};
