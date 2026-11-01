// Writing the ledger (format §5.2–§5.7). The same state always gives the same bytes, so diffs stay
// small and merges are kept simple.

import { findLedger } from './ledger-read.ts';
import { encodePayload } from './payload.ts';
import type { Ledger, MarkEntry, Person, TextChange, Thread, YamlValue } from './types.ts';

const NOTE =
  "# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.";

/** A time, which every YAML reader reads as a string (format §2.4). */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

/** Text that is safe as a plain scalar in a block or a flow collection, in every YAML reader: it
 * starts with a letter and has none of `,[]{}#"` or `?` (PyYAML ends a flow scalar there) or a
 * line break. A colon is checked separately. */
const PLAIN = /^[\p{L}_][\p{L}\p{M}\p{N} _.@/+()=!'\\|*&%$~^<>;:-]*$/u;

/** Words that YAML 1.1 readers turn into booleans or null (format §2.4). */
const YAML_WORD = /^(?:y|n|yes|no|on|off|true|false|null)$/i;

/** Control characters that YAML can't hold as they are. They are written as `\xHH`. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

function escapeControls(encoded: string): string {
  return encoded.replace(CONTROLS, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** A one-line string as a YAML scalar: plain when that reads back the same in every parser, else
 * double-quoted. The payload escapes apply (format §5.5). */
function scalar(value: string): string {
  const encoded = escapeControls(encodePayload(value));
  const plain =
    TIME.test(encoded) ||
    (PLAIN.test(encoded) &&
      !/:(?:\s|$)/.test(encoded) &&
      !/\s$/.test(encoded) &&
      !YAML_WORD.test(encoded));
  return plain ? encoded : `"${encoded.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Free text as a literal block. A blank line is written as a line holding only `\`, and a line
 * holding only `\` as `\\`, because some Markdown tools end an HTML comment at a blank line
 * (format §5.5). */
function block(indent: string, key: string, text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return [
    `${indent}${key}: |-`,
    ...lines.map((line, i) => {
      let written: string;
      if (line === '') written = '\\';
      else if (line === '\\') written = '\\\\';
      else written = escapeControls(encodePayload(line));
      // The first line sets the block's indentation, so its leading spaces can't stay as they are.
      if (i === 0) written = written.replace(/^ +/, (spaces) => '\\x20'.repeat(spaces.length));
      return `${indent}  ${written}`;
    }),
  ];
}

/** A flow map or sequence, which can hold any value. */
function flow(value: YamlValue): string {
  if (typeof value === 'string') return scalar(value);
  if (Array.isArray(value)) return `[${value.map(flow).join(', ')}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${scalar(key)}: ${flow(item)}`)
    .join(', ')}}`;
}

/** A top-level extra key: the value in block style, one level deep, and flow style below that. */
function extraLines(key: string, value: YamlValue): string[] {
  if (typeof value === 'string') return [`${scalar(key)}: ${scalar(value)}`];
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${scalar(key)}: []`]
      : [`${scalar(key)}:`, ...value.map((item) => `  - ${flow(item)}`)];
  }
  const entries = Object.entries(value);
  return entries.length === 0
    ? [`${scalar(key)}: {}`]
    : [`${scalar(key)}:`, ...entries.map(([k, item]) => `  ${scalar(k)}: ${flow(item)}`)];
}

/** `{key: value, …}` for values that are already written. */
function flowMap(fields: [key: string, written: string][]): string {
  return `{${fields.map(([key, written]) => `${key}: ${written}`).join(', ')}}`;
}

function flowList(items: string[]): string {
  return `[${items.map(scalar).join(', ')}]`;
}

function personLine(person: Person): string {
  const fields: [string, string][] = [['name', scalar(person.name)]];
  if (person.email !== undefined) fields.push(['email', scalar(person.email)]);
  if (person.org !== undefined) fields.push(['org', scalar(person.org)]);
  if (person.accounts) fields.push(['accounts', flowList(person.accounts)]);
  if (person.aliases) fields.push(['aliases', flowList(person.aliases)]);
  if (person.agent) fields.push(['agent', 'true']);
  if (person.for !== undefined) fields.push(['for', scalar(person.for)]);
  if (person.members) fields.push(['members', flowList(person.members)]);
  if (person.deleted) fields.push(['deleted', 'true']);
  return `  ${scalar(person.handle)}: ${flowMap(fields)}`;
}

function entryLine(id: string, entry: MarkEntry): string {
  const fields: [string, string][] = [
    ['by', scalar(entry.by)],
    ['at', scalar(entry.at)],
  ];
  if (entry.group !== undefined) fields.push(['group', scalar(entry.group)]);
  if (entry.note !== undefined) fields.push(['note', scalar(entry.note)]);
  if (entry.move !== undefined) fields.push(['move', scalar(entry.move)]);
  if (entry.parts !== undefined) fields.push(['parts', scalar(entry.parts)]);
  return `  ${scalar(id)}: ${flowMap(fields)}`;
}

function threadLines(thread: Thread): string[] {
  const lines = [`  ${scalar(thread.id)}:`];
  const field = (key: string, value: string) => lines.push(`    ${key}: ${scalar(value)}`);
  field('by', thread.by);
  field('at', thread.at);
  if (thread.about !== undefined) field('about', thread.about);
  if (thread.edited !== undefined) field('edited', thread.edited);
  if (thread.resolved) field('resolved', `${thread.resolved.by} ${thread.resolved.at}`);
  if (thread.assigned !== undefined) field('assigned', thread.assigned);
  if (thread.done) lines.push('    done: true');
  if (thread.likes.length > 0) {
    lines.push('    likes:');
    for (const like of thread.likes) lines.push(`      - ${scalar(`${like.by} ${like.at}`)}`);
  }
  if (thread.replies.length > 0) {
    lines.push('    replies:');
    for (const reply of thread.replies) {
      lines.push(
        `      - id: ${scalar(reply.id)}`,
        `        by: ${scalar(reply.by)}`,
        `        at: ${scalar(reply.at)}`,
        ...block('        ', 'text', reply.text),
      );
    }
  }
  if (thread.quote !== undefined) lines.push(...block('    ', 'quote', thread.quote));
  lines.push(...block('    ', 'text', thread.text));
  return lines;
}

/**
 * The whole ledger comment, from `<!-- redlines` to `-->`, with LF line breaks and no trailing
 * newline. People are sorted by handle. Marks and threads are written in the order the ledger
 * holds them, which should be the order of the document.
 */
export function serializeLedger(ledger: Ledger): string {
  const lines = ['<!-- redlines', NOTE, 'version: 1'];
  if (ledger.tracking) lines.push(`tracking: ${ledger.tracking}`);
  if (ledger.history === 'full') lines.push('history: full');
  if (ledger.people.length > 0) {
    lines.push('people:');
    const sorted = ledger.people.toSorted((a, b) =>
      a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0,
    );
    lines.push(...sorted.map(personLine));
  }
  const marks = Object.entries(ledger.marks);
  if (marks.length > 0) lines.push('marks:', ...marks.map(([id, entry]) => entryLine(id, entry)));
  if (ledger.comments.length > 0) lines.push('comments:', ...ledger.comments.flatMap(threadLines));
  for (const [key, value] of Object.entries(ledger.extra ?? {}))
    lines.push(...extraLines(key, value));
  lines.push('-->');
  return lines.join('\n');
}

/** A ledger with no marks, no comments and no settings is not written (format §5.1). */
function isEmpty(ledger: Ledger): boolean {
  return (
    Object.keys(ledger.marks).length === 0 &&
    ledger.comments.length === 0 &&
    !ledger.tracking &&
    ledger.history !== 'full' &&
    Object.keys(ledger.extra ?? {}).length === 0
  );
}

/**
 * The changes that make `ledger` the ledger of `text`: inserted after the body, replaced where it
 * is, or removed with its blank line when it holds nothing. An unchanged ledger gives no changes.
 * Line breaks follow the file's.
 */
export function setLedger(text: string, ledger: Ledger): TextChange[] {
  const existing = findLedger(text);
  if (isEmpty(ledger)) {
    return existing ? [{ from: existing.range.from, to: existing.range.to, insert: '' }] : [];
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const written = serializeLedger(ledger).replaceAll('\n', eol);
  if (existing) {
    if (text.slice(existing.start, existing.range.to) === written) return [];
    return [{ from: existing.start, to: existing.range.to, insert: written }];
  }
  const bodyEnd = text.replace(/(?:\r?\n)+$/, '').length;
  const gap = bodyEnd === 0 ? '' : eol + eol;
  return [{ from: bodyEnd, to: text.length, insert: `${gap}${written}${eol}` }];
}
