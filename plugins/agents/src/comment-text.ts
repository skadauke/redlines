// What a comment's note shows of its text (spec: How agents write, The file sidebar): an agent's
// longer message folded behind More, and a path or `path:line` naming a real file inside the
// project as a link that opens it. Neither is written to the file: the fold is per-person state
// and a link is worked out when the comment is shown. The text is untrusted, so the DOM is built
// with `textContent` only.

import { foldComment } from '@redlines/agent-tools';
import type { Person } from '@redlines/format';

export interface Citation {
  /** Where the citation starts and ends in the text, the line number included. */
  from: number;
  to: number;
  path: string;
  line?: number;
}

// A path made of names, with an optional `./`, `../` or `/` in front. Not after a character that
// would make it the middle of something else, such as a URL or an address.
const CITATION =
  /(?<![\w/:.@~-])((?:\.{1,2}\/|\/)?(?:[\w@+~-][\w.@+~-]*\/)*[\w@+~-][\w.@+~-]*)(?::(\d+))?/g;
// A file name ends in a dot and a word that starts with a letter, so `e.g.` and `1.5` are not files.
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]+$/;

/** The files a text names: `importer.ts:42`, `docs/format.md`, `src/a.ts:3`. */
export function findCitations(text: string): Citation[] {
  const found: Citation[] = [];
  for (const match of text.matchAll(CITATION)) {
    const name = match[1] ?? '';
    // A full stop at the end of a sentence is not part of the name, and then no line follows it.
    const path = name.replace(/\.+$/, '');
    if (!EXTENSION.test(path)) continue;
    const line = match[2] !== undefined && path === name ? Number(match[2]) : undefined;
    const to = match.index + path.length + (line === undefined ? 0 : match[0].length - name.length);
    found.push({ from: match.index, to, path, ...(line === undefined ? {} : { line }) });
  }
  return found;
}

/** `path` with `.` and `..` worked out, or null when `..` climbs out of the top. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.pop() === undefined) return null;
  }
  return `/${parts.join('/')}`;
}

/**
 * The places a cited path may be, in the order to look: next to the document, then at the project
 * root. Only a place inside the project is one: `../../etc/passwd` and a path outside it have none.
 */
export function resolveCitation(path: string, documentFolder: string, root: string): string[] {
  const top = normalize(root);
  if (top === null) return [];
  const prefix = top === '/' ? '/' : `${top}/`;
  const bases = path.startsWith('/') ? [''] : [documentFolder, root];
  const places: string[] = [];
  for (const base of bases) {
    const place = normalize(path.startsWith('/') ? path : `${base}/${path}`);
    if (place !== null && place.startsWith(prefix) && !places.includes(place)) places.push(place);
  }
  return places;
}

export interface CommentTextDeps {
  /** The open document's path, or null for one not saved yet. */
  documentPath(): string | null;
  /** The project folder of a document: the folder a link may open files in. */
  projectFolder(documentPath: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** Opens a file in a new window, at a line. */
  open(path: string, line?: number): void;
}

export interface CommentTextEntry {
  by: string;
  text: string;
  /** Asks the rail to lay itself out again: the note's size changed. */
  resized?(): void;
}

const STYLE_ID = 'rl-comment-text-style';
const STYLE = `
.rl-citation {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rl-rule);
  text-underline-offset: 2px;
  cursor: pointer;
}
.rl-citation:hover { text-decoration-color: currentColor; }
.rl-more {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--rl-ink-2);
  font: inherit;
  cursor: pointer;
}
.rl-more:hover { color: var(--rl-ink); }
.rl-comment-more { display: block; margin-top: 0.6em; }
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

/** Which More are open, for as long as the window is: per person, and never saved. */
const opened = new WeakMap<CommentTextDeps, Set<string>>();
/** The project folder found for a document, kept so that each note doesn't ask again. */
const folders = new WeakMap<CommentTextDeps, Map<string, Promise<string | null>>>();

function projectFolderOf(deps: CommentTextDeps, documentPath: string): Promise<string | null> {
  let known = folders.get(deps);
  if (!known) {
    known = new Map<string, Promise<string | null>>();
    folders.set(deps, known);
  }
  let folder = known.get(documentPath);
  if (!folder) {
    folder = deps.projectFolder(documentPath).catch(() => null);
    known.set(documentPath, folder);
  }
  return folder;
}

/** The file each citation names, where it exists inside the project. */
async function findFiles(deps: CommentTextDeps, citations: Citation[]): Promise<(string | null)[]> {
  const documentPath = deps.documentPath();
  if (documentPath === null) return citations.map(() => null);
  const root = await projectFolderOf(deps, documentPath);
  if (root === null) return citations.map(() => null);
  const folder = documentPath.slice(0, Math.max(documentPath.lastIndexOf('/'), 0));
  return Promise.all(
    citations.map(async ({ path }) => {
      for (const place of resolveCitation(path, folder, root)) {
        if (await deps.exists(place).catch(() => false)) return place;
      }
      return null;
    }),
  );
}

/** `text` in `into`, with a link for each citation whose file is known. */
function fill(
  into: HTMLElement,
  text: string,
  citations: Citation[],
  files: (string | null)[],
  deps: CommentTextDeps,
): void {
  const parts: (string | HTMLAnchorElement)[] = [];
  let at = 0;
  citations.forEach((citation, i) => {
    const file = files[i];
    if (file === null || file === undefined) return;
    parts.push(text.slice(at, citation.from));
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'rl-citation';
    link.title = file;
    link.textContent = text.slice(citation.from, citation.to);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deps.open(file, citation.line);
    });
    parts.push(link);
    at = citation.to;
  });
  parts.push(text.slice(at));
  into.replaceChildren(...parts);
}

/**
 * What a note shows of a comment's text. For an agent's comment it is the first paragraph and a
 * quiet More that opens the rest in place; a person's comment is always whole. A path that names a
 * file inside the project is drawn plain first, and becomes a link once the file is found.
 */
export function renderCommentText(
  entry: CommentTextEntry,
  person: Person | undefined,
  deps: CommentTextDeps,
): HTMLElement {
  addStyle();
  const { shown, more } =
    person?.agent === true ? foldComment(entry.text) : { shown: entry.text, more: null };
  const root = document.createElement('span');
  root.className = 'rl-comment-text';
  const first = document.createElement('span');
  first.textContent = shown;
  root.append(first);
  const pieces = [{ el: first, text: shown, citations: findCitations(shown) }];

  if (more !== null) {
    const rest = document.createElement('span');
    rest.className = 'rl-comment-more';
    rest.textContent = more;
    pieces.push({ el: rest, text: more, citations: findCitations(more) });

    const open = opened.get(deps) ?? new Set<string>();
    opened.set(deps, open);
    const key = `${entry.by}\0${entry.text}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rl-more';
    const draw = () => {
      toggle.textContent = open.has(key) ? 'Less' : 'More';
      if (open.has(key)) root.append(rest);
      else rest.remove();
    };
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (open.has(key)) open.delete(key);
      else open.add(key);
      draw();
      entry.resized?.();
    });
    root.append(' ', toggle);
    draw();
  }

  const all = pieces.flatMap(({ citations }) => citations);
  if (all.length > 0) {
    const before = root.offsetHeight;
    void findFiles(deps, all).then((files) => {
      if (files.every((file) => file === null)) return;
      let index = 0;
      for (const { el, text, citations } of pieces) {
        fill(el, text, citations, files.slice(index, index + citations.length), deps);
        index += citations.length;
      }
      // The rail measures again only if the links changed the note's size.
      if (root.offsetHeight !== before) entry.resized?.();
    });
  }
  return root;
}
