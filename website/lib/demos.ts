// The page's copy for the demo panels: file names, labels and captions. Not the documents,
// which are in apps/website-embed/src/docs, and whose text for the fallback is demo-text.json.

export const demos = {
  plan: {
    file: 'plan.md',
    label: 'Interactive demo: a Markdown document with tracked changes',
    /** Under the fallback, which shows the document as it is first opened. */
    fallbackCaption:
      'Ada added “new”. Claude, working for Ada, suggested “April”. Bo deleted a sentence and asked a question.',
    /** Under the editor, by whether Track Changes is on. */
    caption: {
      tracking: 'Type anywhere. Your edits are tracked, in your color.',
      plain: 'Track Changes is off: your edits are plain text.',
    },
  },
  design: {
    file: 'design.md',
    label: 'Interactive demo: ask a scripted Claude about a design note',
    /** Under the fallback and under the editor. */
    caption:
      'Claude here is a script, so this page needs no account and makes no network request. In the app it is your own Claude Code or Codex, signed in as you, and a click on a file citation opens it.',
  },
  /** The controls the page draws for the panels. */
  controls: {
    views: 'How to show the document',
    trackChanges: 'Track Changes',
    comment: 'Comment',
    review: 'Review',
    reset: 'Reset',
    askClaude: 'Ask Claude',
    tryIt: 'Try it here',
  },
};

/** The panels with a document of their own. */
export type PanelName = Exclude<keyof typeof demos, 'controls'>;
