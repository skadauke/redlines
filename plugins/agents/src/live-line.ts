// A run's live line at the foot of its thread (spec: Agents, steps 3, 4 and 6): what the agent is
// doing, the first-run question, or why it failed. It is never written to the file. This is a
// plain first drawing, so that runs can be tried in the app; the line's real look comes later.

import type { LiveLine } from './runs.ts';

export interface LiveLineActions {
  answer(answer: 'folder' | 'document' | 'no'): void;
  stop(): void;
  dismiss(): void;
}

const STYLE_ID = 'rl-live-line-style';

const STYLE = `
.rl-live-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--rl-rule);
  color: var(--rl-ink-2);
  font-family: var(--rl-font-ui);
  font-size: calc(12px * var(--rl-text-scale, 1));
}
.rl-live-line-name { color: var(--rl-ink); }
.rl-live-line-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function button(text: string, run: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'rl-note-button';
  el.textContent = text;
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    run();
  });
  return el;
}

/** The last part of a path, which names a folder well enough on one line. */
function folderName(folder: string): string {
  return folder.split('/').filter(Boolean).at(-1) ?? folder;
}

export function renderLiveLine(line: LiveLine, actions: LiveLineActions): HTMLElement {
  addStyle();
  const el = document.createElement('div');
  el.className = `rl-live-line rl-live-line-${line.kind}`;
  switch (line.kind) {
    case 'running':
      el.append(
        span('rl-live-line-name', line.agentName),
        span('rl-live-line-text', line.status),
        button('Stop', () => actions.stop()),
      );
      break;
    case 'asking': {
      const machine = line.readLimit === 'machine';
      const question = machine
        ? 'Let it read files on this Mac?'
        : `Let ${line.agentName} read this folder? ${folderName(line.folder)}`;
      const text = span('rl-live-line-text', question);
      text.title = line.folder;
      el.append(
        span('rl-live-line-name', line.agentName),
        text,
        button('Allow', () => actions.answer('folder')),
        ...(machine ? [] : [button('Just this document', () => actions.answer('document'))]),
        button('Not now', () => actions.answer('no')),
      );
      break;
    }
    case 'failed':
      el.setAttribute('role', 'status');
      el.append(
        span('rl-live-line-text', line.message),
        button('Dismiss', () => actions.dismiss()),
      );
      break;
  }
  return el;
}
