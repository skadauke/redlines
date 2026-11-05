// A run's live line at the foot of its thread (spec: Agents, What happens, steps 3, 4 and 6; Status
// lines): what the agent is doing, the first-run question, or why the run failed. It is about right
// now, like a cursor, so it is never written to the file and goes with the document.
//
// It is one quiet gray line: the agent's dot, in the color it writes in, its name and its status,
// which changes in place, with Stop on hover. The dot pulses gently while the agent works, and is
// hollow once the run has failed or stopped. A failure is the line too, never a dialog; only when
// the thread is out of view does it also post a notification.

import { LIMITS } from '@redlines/agent-tools';
import { assignColors, type Author } from '@redlines/editor';
import type { Parsed } from '@redlines/format';
import { icon } from '@redlines/review';
import { agentHandle, type LiveLine, type RunController } from './runs.ts';

export interface LiveLineActions {
  answer(answer: 'folder' | 'document' | 'no'): void;
  stop(): void;
  dismiss(): void;
  /** Shows a failed run's log. Without it, a failure offers none. */
  showLog?: (path: string) => void;
}

export interface LiveLineLook {
  /** The agent's author color class, such as `rl-author-3`. Gray without one. */
  color?: string;
}

/** A failure told of in the window's notifications. */
export interface FailureNotice {
  /** One per thread: a later notice for the thread replaces it. */
  key: string;
  text: string;
  /** Shows the run's log, when it has one. */
  showLog?: () => void;
}

export interface LiveLinesDeps {
  runs: Pick<RunController, 'line' | 'subscribe' | 'answerConsent' | 'stop' | 'dismiss'>;
  /** You, as you are now: an agent writes as `<agent>-<you>`. */
  author: Author;
  /** The document as it is now, for the color the agent writes in. */
  getParsed(): Parsed;
  /** Draws the thread's note again, which asks for its footer: `ReviewController.refreshThread`. */
  refresh(thread: string): void;
  showLog?: (path: string) => void;
  /** Posts a notice in the window's notifications, and returns a way to take it away. */
  notify?: (notice: FailureNotice) => { close(): void };
  /** Whether `el` is where the person can see it. By default, by where it is in the window. */
  inView?: (el: HTMLElement) => boolean;
}

export interface LiveLines {
  /**
   * The thread's live line, for `ThreadExtras.footer`: the same element for as long as the thread
   * has a line, changed in place, or null when it has none.
   */
  footer(thread: string): HTMLElement | null;
}

const STYLE_ID = 'rl-live-line-style';

// In the rail's interface font. The line's text is the second ink; the question, which waits for
// an answer, is the first. The buttons are the notes' own (`rl-note-button`, `rl-note-icon`).
const STYLE = `
.rl-live-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
  color: var(--rl-ink-2);
  font-size: calc(12.5px * var(--rl-text-scale, 1));
  line-height: 1.38;
}
.rl-live-line-dot {
  flex: none;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  /* Level with the middle of the first line. */
  margin-top: calc(0.69em - 3px);
  border-radius: 50%;
  background-color: var(--rl-color);
}
.rl-live-line-name { flex: none; font-weight: 700; }
.rl-live-line-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.rl-live-line-text code { font-family: var(--rl-font-mono); font-size: 0.92em; }

/* Running: one line, which the status never makes taller, with Stop on hover. */
.rl-live-line-running { align-items: center; min-height: 22px; }
.rl-live-line-running .rl-live-line-dot {
  margin-top: 0;
  animation: rl-live-line-pulse 1.8s ease-in-out infinite;
}
.rl-live-line-running .rl-live-line-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/*
 * Out of sight until then, but still in the keyboard's way: Tab reaches it from any note, and it
 * shows while it has the keyboard.
 */
.rl-live-line.rl-live-line-running .rl-live-line-stop {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.rl-note:hover .rl-live-line-running .rl-live-line-stop,
.rl-note-selected .rl-live-line-running .rl-live-line-stop,
.rl-live-line-running:focus-within .rl-live-line-stop {
  position: static;
  flex: none;
  width: auto;
  height: 22px;
  margin: 0 -6px 0 auto;
  padding: 0 6px;
  overflow: visible;
  clip-path: none;
}

/* The first-run question: the folder under it, then the answers. */
.rl-live-line-body { flex: 1 1 auto; min-width: 0; }
.rl-live-line-asking .rl-live-line-text { display: block; color: var(--rl-ink); }
.rl-live-line-folder {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rl-live-line-answers { display: flex; flex-wrap: wrap; gap: 2px; margin: 3px 0 0 -6px; }
.rl-live-line-answers .rl-live-line-allow { color: var(--rl-ink); }

/*
 * Failed or stopped: the dot is hollow. Show log follows the message, in its words; the cross that
 * puts the line away sits at the end of its first row, as a notification's does.
 */
.rl-live-line-failed .rl-live-line-dot {
  background-color: transparent;
  box-shadow: inset 0 0 0 1.25px var(--rl-color);
}
.rl-live-line-text code { white-space: nowrap; }
.rl-live-line-log {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rl-ink-2);
  font: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rl-ink-3);
  text-underline-offset: 2px;
  cursor: default;
}
.rl-live-line-log:hover { color: var(--rl-ink); text-decoration-color: currentColor; }
.rl-live-line-log:focus-visible { outline: 2px solid var(--rl-ink-3); outline-offset: 1px; }
.rl-live-line-dismiss { flex: none; margin: -2px -5px -3px 0; }

@keyframes rl-live-line-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .rl-live-line-running .rl-live-line-dot { animation: none; }
}
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

function span(className: string, text?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A button that keeps the keyboard where it is, as the notes' buttons do. */
function button(className: string, label: string, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('mousedown', (event) => event.preventDefault());
  el.addEventListener('click', () => run());
  return el;
}

/** The cross that puts a failure away, with its name as a hint on hover, as a note's icons have. */
function dismissButton(run: () => void): HTMLButtonElement {
  const el = button('rl-note-icon rl-live-line-dismiss', '', run);
  el.setAttribute('aria-label', 'Dismiss');
  const hint = span('rl-hint', 'Dismiss');
  hint.setAttribute('aria-hidden', 'true');
  el.append(icon('close', 14), hint);
  return el;
}

/**
 * A status as the line shows it: on one line, and at most 40 characters, as the status tool allows.
 * A provider's longer status is cut, with an ellipsis.
 */
export function fitStatus(status: string): string {
  const line = status.replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  if (chars.length <= LIMITS.status) return line;
  return `${chars
    .slice(0, LIMITS.status - 1)
    .join('')
    .trimEnd()}…`;
}

/** The home folder, which a folder is named from, as in `~/code/redlines`. */
const HOME = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;
/** The most characters of a folder the question shows. */
const FOLDER_SHOWN = 32;

/** A folder named in a few words: from home, and a deep one by its start and its end. */
function shortFolder(folder: string): string {
  const path = folder.replace(HOME, '~');
  if (Array.from(path).length <= FOLDER_SHOWN) return path;
  const parts = path.split('/');
  const head = parts[0] === '' ? `/${parts[1] ?? ''}` : (parts[0] ?? '');
  const rest = parts.slice(parts[0] === '' ? 2 : 1);
  let tail = rest.pop() ?? '';
  for (let part = rest.pop(); part !== undefined; part = rest.pop()) {
    const longer = `${part}/${tail}`;
    if (Array.from(`${head}/…/${longer}`).length > FOLDER_SHOWN) break;
    tail = longer;
  }
  return `${head}/…/${tail}`;
}

/** Whether `message` starts with the agent's name, as "Claude isn't signed in." does. */
function startsWithName(message: string, name: string): boolean {
  return message.startsWith(name) && /^(?:$|[\s'’:,.])/.test(message.slice(name.length));
}

/** A failure's words, with a `command` in backticks as code. */
function withCode(text: string): Node[] {
  return text.split(/`([^`]+)`/).map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const code = document.createElement('code');
    code.textContent = part;
    return code;
  });
}

function statusText(status: string): HTMLSpanElement {
  const el = span('rl-live-line-text');
  setStatus(el, status);
  return el;
}

function setStatus(el: Element, status: string): void {
  el.textContent = fitStatus(status);
  // The whole status, a hover away when it is cut, or when the rail is too narrow for it.
  el.setAttribute('title', status.replace(/\s+/g, ' ').trim());
}

/** What the line holds, for each kind of line. Spaces keep the words apart for screen readers. */
function parts(line: LiveLine, actions: LiveLineActions): (Node | string)[] {
  const dot = span('rl-live-line-dot');
  switch (line.kind) {
    case 'running':
      return [
        dot,
        span('rl-live-line-name', line.agentName),
        ' ',
        statusText(line.status),
        button('rl-note-button rl-live-line-stop', 'Stop', () => actions.stop()),
      ];
    case 'asking': {
      const machine = line.readLimit === 'machine';
      const body = span('rl-live-line-body');
      body.append(
        span(
          'rl-live-line-text',
          machine
            ? `Let ${line.agentName} read files on this Mac?`
            : `Let ${line.agentName} read this folder?`,
        ),
      );
      if (!machine) {
        const folder = span('rl-live-line-folder', shortFolder(line.folder));
        folder.title = line.folder;
        body.append(' ', folder);
      }
      const answers = span('rl-live-line-answers');
      answers.append(
        button('rl-note-button rl-live-line-allow', 'Allow', () => actions.answer('folder')),
        // An agent that reads the whole machine can't be held to this document.
        ...(machine
          ? []
          : [button('rl-note-button', 'Just this document', () => actions.answer('document'))]),
        button('rl-note-button', 'Not now', () => actions.answer('no')),
      );
      body.append(answers);
      return [dot, body];
    }
    case 'failed': {
      const { agentName, message, logPath } = line;
      const text = span('rl-live-line-text');
      const named = startsWithName(message, agentName);
      text.append(
        span('rl-live-line-name', agentName),
        ...withCode(named ? message.slice(agentName.length) : ` ${message}`),
      );
      const { showLog } = actions;
      if (logPath !== undefined && showLog) {
        text.append(
          ' ',
          button('rl-live-line-log', 'Show log', () => showLog(logPath)),
        );
      }
      return [dot, text, dismissButton(() => actions.dismiss())];
    }
  }
}

function draw(el: HTMLElement, line: LiveLine, actions: LiveLineActions, look: LiveLineLook) {
  // Gray without a color of its own: never the color of the thread's note, which may be yours.
  el.className = `rl-live-line rl-live-line-${line.kind} ${look.color ?? 'rl-author-0'}`;
  el.setAttribute('role', 'status');
  el.replaceChildren(...parts(line, actions));
}

/** Draws a run's live line. */
export function renderLiveLine(
  line: LiveLine,
  actions: LiveLineActions,
  look: LiveLineLook = {},
): HTMLElement {
  addStyle();
  const el = document.createElement('div');
  draw(el, line, actions, look);
  return el;
}

/**
 * Changes a line drawn for `before` to show `line`. A new status changes only the text, so the dot
 * keeps its pulse, and Stop the pointer or the keyboard.
 */
function redraw(
  el: HTMLElement,
  before: LiveLine,
  line: LiveLine,
  actions: LiveLineActions,
  look: LiveLineLook,
): void {
  const text = el.querySelector('.rl-live-line-text');
  if (before.kind === 'running' && line.kind === 'running' && before.agent === line.agent && text) {
    setStatus(text, line.status);
  } else {
    draw(el, line, actions, look);
  }
}

/** A failure as a notification says it, where nothing else in view names the agent. */
function noticeText({ agentName, message }: LiveLine & { kind: 'failed' }): string {
  const plain = message.replace(/`([^`]+)`/g, '$1');
  return startsWithName(plain, agentName) ? plain : `${agentName}: ${plain}`;
}

/**
 * Whether `el` shows in the window: in the page, laid out, and not scrolled out of anything that
 * clips it.
 */
function shownInWindow(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY === 'visible') continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return bottom > top;
}

/** Runs `fn` once the rail has laid out what was just drawn. */
function afterLayout(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/**
 * The live lines of a window's threads. Each change to a thread's line draws its note again, and
 * a failure that the person can't see, because its thread is scrolled away, shut in a dot or not
 * drawn at all, is also told of in a notification, which goes when the line does.
 */
export function createLiveLines(deps: LiveLinesDeps): LiveLines {
  const { runs } = deps;
  const drawn = new Map<string, { el: HTMLElement; line: LiveLine }>();
  /** Failures already looked at for a notification, so that drawing one again tells of nothing. */
  const looked = new WeakSet<LiveLine>();
  const told = new Map<string, { line: LiveLine; close(): void }>();
  const inView = deps.inView ?? shownInWindow;

  const actionsFor = (thread: string): LiveLineActions => ({
    answer: (answer) => runs.answerConsent(thread, answer),
    stop: () => runs.stop(thread),
    dismiss: () => runs.dismiss(thread),
    ...(deps.showLog ? { showLog: deps.showLog } : {}),
  });

  /** The color the agent writes in, also before it has written anything in this document. */
  function look(agent: string): LiveLineLook {
    const me = deps.author.handle;
    const handle = agentHandle(agent, me);
    const parsed = deps.getParsed();
    let colors = assignColors(parsed, me);
    if (!colors.has(handle)) {
      const people = [...parsed.ledger.people, { handle, name: '' }];
      colors = assignColors({ ...parsed, ledger: { ...parsed.ledger, people } }, me);
    }
    return { color: `rl-author-${colors.get(handle) ?? 0}` };
  }

  function tell(thread: string, line: LiveLine & { kind: 'failed' }): void {
    const { notify, showLog } = deps;
    if (!notify || runs.line(thread) !== line) return;
    const el = drawn.get(thread)?.el;
    if (el && inView(el)) return;
    const { logPath } = line;
    const notice = notify({
      key: `live-line ${thread}`,
      text: noticeText(line),
      ...(logPath !== undefined && showLog ? { showLog: () => showLog(logPath) } : {}),
    });
    told.set(thread, { line, close: () => notice.close() });
  }

  runs.subscribe((thread) => {
    const line = runs.line(thread);
    // Gone, also with a document another took the place of: nothing of it is kept.
    if (line === null) drawn.delete(thread);
    const notice = told.get(thread);
    if (notice && notice.line !== line) {
      told.delete(thread);
      notice.close();
    }
    deps.refresh(thread);
    if (line?.kind === 'failed' && !looked.has(line)) {
      looked.add(line);
      afterLayout(() => tell(thread, line));
    }
  });

  return {
    footer(thread) {
      const line = runs.line(thread);
      if (!line) {
        drawn.delete(thread);
        return null;
      }
      const shown = drawn.get(thread);
      // The rail draws a note again for other reasons too, such as an agent's edit: the same line
      // keeps its buttons, so that one being pressed still gets the click.
      if (shown?.line === line) return shown.el;
      if (shown) {
        redraw(shown.el, shown.line, line, actionsFor(thread), look(line.agent));
        shown.line = line;
        return shown.el;
      }
      const el = renderLiveLine(line, actionsFor(thread), look(line.agent));
      drawn.set(thread, { el, line });
      return el;
    },
  };
}
