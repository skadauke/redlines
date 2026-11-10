// What the website's page may know of the embed: the one function `mountDemo` and its types. The
// site imports this file type-only, by relative path, so it imports nothing itself.

/** The two demos; the bundle holds their documents. */
export type DemoName = 'plan' | 'design';
/** The editor's views, as `ViewMode` has them (a type test in the embed holds them equal). */
export type DemoView = 'clean' | 'redlines' | 'raw';

export interface DemoOptions {
  demo: DemoName;
  /** Called for every change of what the page's controls show, and once at mount. */
  onState(state: DemoState): void;
  /** A message for people, from the editor's `onNotice`: "Raw is read-only while ...". */
  onNotice(message: string): void;
}

export interface DemoState {
  view: DemoView;
  /** What the editor offers, in order, with the words the app's View menu uses. */
  views: readonly { view: DemoView; label: string }[];
  tracking: boolean;
  /** Pending changes: Review is disabled at 0. */
  changes: number;
  /** False in Raw, where the review plugin takes no comment. */
  canComment: boolean;
  claudeRunning: boolean;
}

export interface DemoHandle {
  setView(view: DemoView): void;
  setTracking(on: boolean): void;
  /** Opens the box, as Comment does in the app; false when it did nothing. */
  startComment(): boolean;
  /** 'design' only: selects the sentence, opens the box with the question. */
  askClaude(): boolean;
  openReviewBar(): void;
  /** The original document, the demo's view and tracking, no history. */
  reset(): void;
  /** The file, for tests. */
  getDoc(): string;
  destroy(): void;
}

export type MountDemo = (parent: HTMLElement, options: DemoOptions) => DemoHandle;
