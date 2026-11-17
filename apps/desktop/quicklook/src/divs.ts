// Pandoc's fenced divs, which Quarto writes its callouts, columns and tabsets with:
//
//     ::: {.callout-note}
//     A callout.
//     :::
//
// micromark knows no divs, so a fence line runs into the paragraph beside it and shows as text. A
// small scanner reads the lines first, knowing fenced code and HTML comments, where a line that
// looks like a fence is only text, and makes each fence a block of its own, with a blank line
// around it:
//
// - An opening fence with a `.callout-*` class (note, tip, warning, important, caution) is a quiet
//   box under a label: the fence's `title="…"`, or the kind's name. The text between its fences is
//   drawn as Markdown, inside it.
// - Any other div (`.columns`, `.column`, `.panel-tabset`, `.hidden`, …) is only its text: its
//   fences are dropped.
//
// Only a fence at the start of a line counts, so that a box never opens in a list item or a quote
// and closes outside it, and the boxes always nest. A closing fence with no div open, and an
// opening one with text that is no class or attributes, stay the text they are. A box left open at
// the end of the text is closed there.

/** The kinds of callout that Quarto has, and the label of each. */
const KINDS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  important: 'Important',
  caution: 'Caution',
};

const BOX_END = '</div></div>';

/** What follows a fence's colons, as a div's opening: attributes in braces, or a single class. */
const ATTRIBUTES = /^\{[^{}]*\}$/;
const CLASS_WORD = /^[A-Za-z][\w-]*$/;

/** The kind of callout and the title that a fence's text asks for, or null when it asks for none. */
function calloutOf(info: string): { kind: string; title: string | null } | null {
  let classes: string[];
  let title: string | null = null;
  if (ATTRIBUTES.test(info)) {
    classes = [...info.replace(/"[^"]*"|'[^']*'/g, '""').matchAll(/(?:^|[\s{])\.([\w-]+)/g)].map(
      (found) => found[1] ?? '',
    );
    const given = /(?:^|[\s{])title\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(info);
    title = (given?.[1] ?? given?.[2] ?? '').trim() || null;
  } else {
    classes = [info];
  }
  for (const name of classes) {
    const kind = /^callout-(.+)$/.exec(name)?.[1];
    if (kind !== undefined && Object.hasOwn(KINDS, kind)) return { kind, title };
  }
  return null;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function boxStart(kind: string, title: string | null): string {
  const label = title ?? KINDS[kind] ?? '';
  return `<div class="rl-callout rl-callout-${kind}"><p class="rl-callout-label">${escape(label)}</p><div class="rl-callout-body">`;
}

/** Whether a comment is open at the end of `text`, which starts outside one. */
function commentOpensIn(text: string): boolean {
  let at = 0;
  for (;;) {
    const start = text.indexOf('<!--', at);
    if (start < 0) return false;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) return true;
    at = end + 3;
  }
}

/** The text with its fences marked as blocks, and what turns the HTML of that text into the page's. */
export interface MarkedDivs {
  text: string;
  /** `html`, drawn from `text`, with each mark replaced by its box. */
  finish(html: string): string;
}

export function markDivs(source: string): MarkedDivs {
  const unchanged = { text: source, finish: (html: string) => html };
  if (!source.includes(':::')) return unchanged;

  // A token that the source doesn't hold, one paragraph's text, for each place a box starts or ends.
  let nonce = 'rldiv';
  while (source.includes(nonce)) nonce += 'x';
  const marks: string[] = [];
  const mark = (html: string): string => {
    marks.push(html);
    return `${nonce}${marks.length - 1}z`;
  };

  const open: boolean[] = []; // for each div open, whether it is a box
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let comment = false;

  for (const line of source.split(/(?<=\n)/)) {
    const eol = /\r?\n$/.exec(line)?.[0] ?? '';
    const body = line.slice(0, line.length - eol.length);

    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body)?.[1];
      if (close?.[0] === fence.char && close.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (comment) {
      const end = body.indexOf('-->');
      if (end >= 0) comment = commentOpensIn(body.slice(end + 3));
      out.push(line);
      continue;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
    if (opening !== null) {
      const [, ticks = '', info = ''] = opening;
      if (!(ticks.startsWith('`') && info.includes('`'))) {
        fence = { char: ticks.charAt(0), length: ticks.length };
        out.push(line);
        continue;
      }
    }
    if (/^ {0,3}<!--/.test(body) && commentOpensIn(body)) {
      comment = true;
      out.push(line);
      continue;
    }

    const colons = /^:{3,}[ \t]*(.*?)[ \t]*$/.exec(body);
    if (colons !== null) {
      const info = colons[1] ?? '';
      if (info === '' || /^:+$/.test(info)) {
        if (open.length > 0) {
          out.push(open.pop() ? `\n${mark(BOX_END)}\n\n` : '\n');
          continue;
        }
      } else if (ATTRIBUTES.test(info) || CLASS_WORD.test(info)) {
        const callout = calloutOf(info);
        open.push(callout !== null);
        out.push(callout === null ? '\n' : `\n${mark(boxStart(callout.kind, callout.title))}\n\n`);
        continue;
      }
    }
    out.push(line);
  }
  for (const box of open.reverse()) if (box) out.push(`\n\n${mark(BOX_END)}\n`);

  const paragraph = new RegExp(`<p>${nonce}(\\d+)z</p>\\n?`, 'g');
  const left = new RegExp(`${nonce}\\d+z`, 'g');
  return {
    text: out.join(''),
    finish: (html) => {
      let starts = 0;
      let ends = 0;
      const drawn = html.replace(paragraph, (_, n: string) => {
        const box = marks[Number(n)] ?? '';
        if (box === BOX_END) ends += 1;
        else if (box !== '') starts += 1;
        return box;
      });
      // A mark inside a raw HTML block (an unclosed <pre>, say) isn't a paragraph, and can't be
      // drawn: then no box is, rather than boxes that don't balance.
      if (starts === ends) return drawn.replace(left, '');
      return html.replace(paragraph, '').replace(left, '');
    },
  };
}
