// What a comment's note shows of its text (spec: How agents write, The file sidebar): an agent's
// longer message folded behind More, and a path or `path:line` naming a real file inside the
// project as a link, which opens it or says the app doesn't. Neither is written to the file: the
// fold is per-person state and a link is worked out when the comment is shown. The text is
// untrusted, so the DOM is built with `textContent` only.

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
  /** The file as it really is, links followed. Rejects for a file that is not there. */
  realPath(path: string): Promise<string>;
  /**
   * How a file named by a citation opens: `window` for a document, in a new window; `default` for
   * an image or a PDF, in its default app; `none` for any other file, which the app doesn't open,
   * and whose link says so (`cannotOpen`).
   */
  opensIn(path: string): 'window' | 'default' | 'none';
  /** Opens a file in a new window, at a line. */
  open(path: string, line?: number): void;
  /** Opens an image or a PDF, inside the project folder `root`, in its default app. */
  openDefault(path: string, root: string): void;
  /** Says that the app doesn't open the file at `path`, whose link the person followed (`none`). */
  cannotOpen(path: string): void;
}

export interface CommentTextEntry {
  /** The comment's or reply's id, which More is remembered by. */
  id?: string;
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
const opened = new Set<string>();

/** A project as the window sees it: its folder, and the folder as it really is. */
interface Project {
  root: string;
  real: string;
}

/** The project found for a document, kept a while so that each note doesn't ask again. */
const projects = new Map<string, { at: number; project: Promise<Project | null> }>();
const PROJECT_KEPT_MS = 10_000;

function projectOf(deps: CommentTextDeps, documentPath: string): Promise<Project | null> {
  const known = projects.get(documentPath);
  if (known && Date.now() - known.at < PROJECT_KEPT_MS) return known.project;
  const project = deps
    .projectFolder(documentPath)
    .then(async (root) => (root === null ? null : { root, real: await deps.realPath(root) }))
    .catch(() => null);
  projects.set(documentPath, { at: Date.now(), project });
  return project;
}

/** Where a citation's file is, and how it opens: only a file really inside the project has one. */
interface Target {
  file: string;
  root: string;
  opensIn: 'window' | 'default' | 'none';
}

async function findFiles(deps: CommentTextDeps, citations: Citation[]): Promise<(Target | null)[]> {
  const documentPath = deps.documentPath();
  if (documentPath === null) return citations.map(() => null);
  const project = await projectOf(deps, documentPath);
  if (project === null) return citations.map(() => null);
  const folder = documentPath.slice(0, Math.max(documentPath.lastIndexOf('/'), 0));
  const inside = project.real === '/' ? '/' : `${project.real}/`;
  return Promise.all(
    citations.map(async ({ path }): Promise<Target | null> => {
      for (const place of resolveCitation(path, folder, project.root)) {
        // The file as it really is: a link inside the project that points out is not inside it.
        const file = await deps.realPath(place).catch(() => null);
        if (file === null || !file.startsWith(inside)) continue;
        return { file, root: project.real, opensIn: deps.opensIn(file) };
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
  files: (Target | null)[],
  deps: CommentTextDeps,
): void {
  const parts: (string | HTMLAnchorElement)[] = [];
  let at = 0;
  citations.forEach((citation, i) => {
    const target = files[i];
    if (target === null || target === undefined) return;
    const { file, root, opensIn } = target;
    parts.push(text.slice(at, citation.from));
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'rl-citation';
    link.title = file;
    link.textContent = text.slice(citation.from, citation.to);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (opensIn === 'window') deps.open(file, citation.line);
      else if (opensIn === 'default') deps.openDefault(file, root);
      // A file the app doesn't open opens nothing, from here or anywhere: not even in another app.
      else deps.cannotOpen(file);
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

    const open = opened;
    // By the comment, not by the call: a note is drawn again for every edit.
    const key = `${deps.documentPath() ?? ''}\0${entry.id ?? `${entry.by}\0${entry.text}`}`;
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
    void findFiles(deps, all).then((files) => {
      if (files.every((file) => file === null)) return;
      const before = root.offsetHeight;
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
