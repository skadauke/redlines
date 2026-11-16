// The report a failure offers (#692): what happened, in words and numbers, for the person to review
// and send as a GitHub issue. It holds the build, the system, the trace and the shape of the
// document (sizes and counts), and never a word of the document itself.

/** What a document's size and make-up are, never what it says (src-tauri/src/crash.rs `Shape`). */
export interface Shape {
  bytes: number;
  lines: number;
  longestLine: number;
  marks: number;
  comments: number;
  images: number;
  tables: number;
}

export type ProblemKind = 'page-error' | 'web-process' | 'panic' | 'app-crash' | 'hang';

/** One failure, as the app logged it (src-tauri/src/crash.rs `Problem`). */
export interface Problem {
  id: string;
  kind: ProblemKind;
  at: string;
  window: string | null;
  message: string;
  trace: string;
  shape: Shape | null;
  doing: string | null;
  memoryKb: number | null;
  macos: string;
  build: string;
}

/** Where reports go. */
export const ISSUES_URL = 'https://github.com/skadauke/redlines/issues/new';

/** The most a link to a new issue may be, which GitHub and the browsers take. */
const MAX_URL = 7000;

const MARKS = /<!--(?:ins|del|sub|fmt|hl|split) /g;
const COMMENTS = /<!--cmt /g;
const IMAGES = /!\[[^\]\n]*\]\(/g;
// A table's delimiter row: dashes and colons between pipes, and nothing else.
const TABLE_ROWS = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** The size and make-up of `text`: numbers only. */
export function documentShape(text: string): Shape {
  let lines = 1;
  let longest = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf('\n', from);
    const end = at === -1 ? text.length : at;
    if (end - from > longest) longest = end - from;
    if (at === -1) break;
    lines++;
    from = at + 1;
  }
  const tables = (text.match(TABLE_ROWS) ?? []).filter((row) => row.includes('|')).length;
  return {
    bytes: new TextEncoder().encode(text).length,
    lines,
    longestLine: longest,
    marks: count(text, MARKS),
    comments: count(text, COMMENTS),
    images: count(text, IMAGES),
    tables,
  };
}

/** What a notification says of a failure. */
export function problemText(problem: Problem): string {
  switch (problem.kind) {
    case 'web-process':
      return 'Redlines had a problem and reloaded this window.';
    case 'hang':
      return 'Redlines stopped responding for a while, and is back.';
    case 'panic':
    case 'app-crash':
      return 'Redlines had a problem the last time it ran.';
    case 'page-error':
      return 'Redlines had a problem. Your document is still open.';
  }
}

const KINDS: Record<ProblemKind, string> = {
  'page-error': 'An error in the page',
  'web-process': 'The page’s process ended',
  panic: 'A panic in the app',
  'app-crash': 'The app crashed',
  hang: 'The page stopped responding',
};

/** The line about the shape of the document. */
export function shapeLine(shape: Shape): string {
  const n = (value: number) => value.toLocaleString('en-US');
  return (
    `${n(shape.bytes)} bytes, ${n(shape.lines)} lines, longest line ${n(shape.longestLine)}, ` +
    `${n(shape.marks)} changes, ${n(shape.comments)} comments, ${n(shape.images)} images, ` +
    `${n(shape.tables)} tables`
  );
}

export interface Environment {
  build: string;
  macos: string;
}

export interface Report {
  title: string;
  body: string;
  /** A new issue, filled in, for the person to review and submit. */
  url: string;
}

function bodyOf(
  problem: Problem | null,
  environment: Environment,
  shape: Shape | null,
  trace: string,
): string {
  const lines = ['**What were you doing?**', '', '(Please say, in a line or two.)', ''];
  lines.push('**Details**', '');
  if (problem) {
    lines.push(`- What happened: ${KINDS[problem.kind]} (${problem.at})`);
    lines.push(`- Build: ${problem.build}`, `- System: ${problem.macos}`);
    if (problem.memoryKb !== null) {
      lines.push(`- Memory in use: ${Math.round(problem.memoryKb / 1024)} MB`);
    }
    if (problem.doing) lines.push(`- Last doing: ${problem.doing}`);
  } else {
    lines.push(`- Build: ${environment.build}`, `- System: ${environment.macos}`);
  }
  if (shape) lines.push(`- Document (shape only, no text): ${shapeLine(shape)}`);
  if (problem) {
    lines.push('', '**Message**', '', '```', problem.message, '```');
    if (trace) lines.push('', '**Trace**', '', '```', trace, '```');
  }
  lines.push('', '_Redlines left the document’s text out. The full log is in Help › Reveal Log._');
  return lines.join('\n');
}

/**
 * The report for `problem`, or for none (Help › Report a Problem…). `shape` is the open document's,
 * when the failure didn't carry one. The trace is cut until the link is short enough to open.
 */
export function reportFor(
  problem: Problem | null,
  environment: Environment,
  shape: Shape | null,
): Report {
  const title = problem ? `Problem: ${KINDS[problem.kind]}` : 'Problem: ';
  const shown = problem?.shape ?? shape;
  let trace = problem?.trace ?? '';
  const make = () => {
    const body = bodyOf(problem, environment, shown, trace);
    const url = `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    return { title, body, url };
  };
  let report = make();
  while (report.url.length > MAX_URL && trace.length > 0) {
    // The top of a trace says the most.
    trace = trace.slice(0, Math.floor(trace.length * 0.7)).replace(/\n[^\n]*$/, '') + '\n…';
    if (trace.length < 40) trace = '';
    report = make();
  }
  return report;
}
