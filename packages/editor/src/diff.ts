// The changes that turn one version of a text into another: a line diff (Myers' algorithm), with
// each changed stretch trimmed to the characters that differ. Applied together, they leave the
// unchanged text where it was, so a reload keeps the selection, the drawn lines and the undo
// history around an agent's edits.

/** A change in the old text's offsets. Lists of them are sorted and don't overlap. */
export interface Change {
  from: number;
  to: number;
  insert: string;
}

/**
 * Past this many inserted and deleted lines the diff gives up, and the lines between the first
 * and the last change are replaced as one stretch.
 */
const MAX_EDITS = 1000;

/** The lines of a text, each with its line break; the last has none and may be empty. */
function lines(text: string): string[] {
  const parts = text.split('\n');
  return parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line));
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code < 0xdc00;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code < 0xe000;

/** `a`'s stretch `aFrom`–`aTo` replaced by `b`'s `bFrom`–`bTo`, less what they share at either end. */
function trimmed(a: string, b: string, aFrom: number, aTo: number, bFrom: number, bTo: number) {
  const shorter = Math.min(aTo - aFrom, bTo - bFrom);
  let start = 0;
  while (start < shorter && a.charCodeAt(aFrom + start) === b.charCodeAt(bFrom + start)) start++;
  // A cut never falls between the two halves of a surrogate pair.
  if (start > 0 && isHighSurrogate(a.charCodeAt(aFrom + start - 1))) start--;
  let end = 0;
  while (end < shorter - start && a.charCodeAt(aTo - 1 - end) === b.charCodeAt(bTo - 1 - end)) {
    end++;
  }
  if (end > 0 && isLowSurrogate(a.charCodeAt(aTo - end))) end--;
  return { from: aFrom + start, to: aTo - end, insert: b.slice(bFrom + start, bTo - end) };
}

/** Changed stretches of lines: `[aFrom, aTo, bFrom, bTo]`. */
type Hunk = [number, number, number, number];

/**
 * Myers' diff of two lists of lines, as the stretches that differ, or null when it would take
 * more than `MAX_EDITS` inserted and deleted lines.
 */
function diffLines(a: string[], b: string[]): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return n || m ? [[0, n, 0, m]] : [];
  const ids = new Map<string, number>();
  const id = (line: string) => {
    let known = ids.get(line);
    if (known === undefined) ids.set(line, (known = ids.size));
    return known;
  };
  const left = Int32Array.from(a, id);
  const right = Int32Array.from(b, id);
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  // The furthest x reached on each diagonal k = x - y, and before each step the part of it that
  // the step reads, for walking back.
  const furthest = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(furthest.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && furthest[offset + k - 1]! < furthest[offset + k + 1]!);
      let x = down ? furthest[offset + k + 1]! : furthest[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && left[x] === right[y]) {
        x++;
        y++;
      }
      furthest[offset + k] = x;
      if (x >= n && y >= m) return hunks(trace, d, n, m);
    }
  }
  return null;
}

/** Walks the trace back from the end, marking the lines deleted from `a` and inserted from `b`. */
function hunks(trace: Int32Array[], steps: number, n: number, m: number): Hunk[] {
  const deleted = new Uint8Array(n);
  const inserted = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let d = steps; d > 0; d--) {
    const before = trace[d]!;
    const at = (k: number) => before[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previous = down ? k + 1 : k - 1;
    const px = at(previous);
    const py = px - previous;
    if (down) inserted[py] = 1;
    else deleted[px] = 1;
    x = px;
    y = py;
  }
  const result: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && !deleted[i] && !inserted[j]) {
      i++;
      j++;
      continue;
    }
    const start: [number, number] = [i, j];
    while ((i < n && deleted[i]) || (j < m && inserted[j])) {
      while (i < n && deleted[i]) i++;
      while (j < m && inserted[j]) j++;
    }
    // A sound edit script leaves no unmatched line behind; should one appear, it is replaced.
    if (start[0] === i && start[1] === j) [i, j] = [n, m];
    result.push([start[0], i, start[1], j]);
  }
  return result;
}

/** The changes that turn `a` into `b`, each as small as the line diff and its trimming allow. */
export function lineChanges(a: string, b: string): Change[] {
  if (a === b) return [];
  const left = lines(a);
  const right = lines(b);
  let first = 0;
  while (first < left.length && first < right.length && left[first] === right[first]) first++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > first && rightEnd > first && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const leftMiddle = left.slice(first, leftEnd);
  const rightMiddle = right.slice(first, rightEnd);
  const found = diffLines(leftMiddle, rightMiddle) ?? [
    [0, leftMiddle.length, 0, rightMiddle.length],
  ];
  // Where each middle line starts in its text.
  const starts = (list: string[], before: string[]) => {
    const result = [before.reduce((length, line) => length + line.length, 0)];
    for (const line of list) result.push(result.at(-1)! + line.length);
    return result;
  };
  const leftStarts = starts(leftMiddle, left.slice(0, first));
  const rightStarts = starts(rightMiddle, right.slice(0, first));
  return found.map(([aFrom, aTo, bFrom, bTo]) =>
    trimmed(a, b, leftStarts[aFrom]!, leftStarts[aTo]!, rightStarts[bFrom]!, rightStarts[bTo]!),
  );
}
