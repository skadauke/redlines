// Writing the ledger (format §5.2–§5.7). The same state always gives the same bytes, so diffs stay
// small and merges are kept simple.

import { EditError } from './errors.ts';
import { findLedger, readLedger } from './ledger-read.ts';
import { encodePayload } from './payload.ts';
import type {
  ExtraFields,
  Ledger,
  MarkEntry,
  Person,
  TextChange,
  Thread,
  YamlValue,
} from './types.ts';

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

/** A key that needs no quotes: what ids and handles are made of, with no `--`. */
const PLAIN_KEY = /^[A-Za-z_](?:[A-Za-z0-9_]|-(?!-))*$/;

/**
 * A key: an id, a handle or the name of a field. The reader takes keys as YAML gives them, with no
 * payload escapes, so a key is plain or, when it isn't made of letters, digits, `-` and `_`, is a
 * double-quoted YAML string. A `--` is written `-\x2d`, because older Markdown parsers end a
 * comment that contains one.
 */
function key(value: string): string {
  if (PLAIN_KEY.test(value) && !YAML_WORD.test(value)) return value;
  const quoted = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(CONTROLS, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/(?<=-)-/g, '\\x2d');
  return `"${quoted}"`;
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
function block(indent: string, name: string, text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return [
    `${indent}${name}: |-`,
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
    .map(([name, item]) => `${key(name)}: ${flow(item)}`)
    .join(', ')}}`;
}

/**
 * A field whose value can be anything, in block style one level deep, and in flow style below that.
 * `name` is the key as it is written. A text of several lines is a literal block, as free text is.
 */
function valueLines(indent: string, name: string, value: YamlValue): string[] {
  if (typeof value === 'string') {
    return value.includes('\n')
      ? block(indent, name, value)
      : [`${indent}${name}: ${scalar(value)}`];
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${indent}${name}: []`]
      : [`${indent}${name}:`, ...value.map((item) => `${indent}  - ${flow(item)}`)];
  }
  const entries = Object.entries(value);
  return entries.length === 0
    ? [`${indent}${name}: {}`]
    : [`${indent}${name}:`, ...entries.map(([k, item]) => `${indent}  ${key(k)}: ${flow(item)}`)];
}

/** The fields this version doesn't know, after the ones it does (format §5.7). */
function extraFields(extra: ExtraFields | undefined): [name: string, written: string][] {
  return Object.entries(extra ?? {}).map(([name, value]) => [key(name), flow(value)]);
}

/** `{key: value, …}` for values that are already written. */
function flowMap(fields: [name: string, written: string][]): string {
  return `{${fields.map(([name, written]) => `${name}: ${written}`).join(', ')}}`;
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
  fields.push(...extraFields(person.extra));
  return `  ${key(person.handle)}: ${flowMap(fields)}`;
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
  fields.push(...extraFields(entry.extra));
  return `  ${key(id)}: ${flowMap(fields)}`;
}

function threadLines(thread: Thread): string[] {
  const lines = [`  ${key(thread.id)}:`];
  const field = (name: string, value: string) => lines.push(`    ${name}: ${scalar(value)}`);
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
  if (thread.reactions !== undefined)
    lines.push(...valueLines('    ', 'reactions', thread.reactions));
  if (thread.replies.length > 0) {
    lines.push('    replies:');
    for (const reply of thread.replies) {
      lines.push(
        `      - id: ${scalar(reply.id)}`,
        `        by: ${scalar(reply.by)}`,
        `        at: ${scalar(reply.at)}`,
        ...block('        ', 'text', reply.text),
      );
      for (const [name, value] of Object.entries(reply.extra ?? {})) {
        lines.push(...valueLines('        ', key(name), value));
      }
    }
  }
  if (thread.quote !== undefined) lines.push(...block('    ', 'quote', thread.quote));
  lines.push(...block('    ', 'text', thread.text));
  for (const [name, value] of Object.entries(thread.extra ?? {})) {
    lines.push(...valueLines('    ', key(name), value));
  }
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
  for (const [name, value] of Object.entries(ledger.extra ?? {}))
    lines.push(...valueLines('', key(name), value));
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

export interface SetLedgerOptions {
  /** Replace or remove a ledger that can't be read, and with it whatever is in it. */
  replaceUnreadable?: boolean;
}

/**
 * The changes that make `ledger` the ledger of `text`: inserted after the body, replaced where it
 * is, or removed with its blank line when it holds nothing. An unchanged ledger gives no changes.
 * Line breaks follow the file's.
 *
 * @throws EditError when the file's ledger can't be read, for example after a merge conflict:
 *   writing would lose what is in it. Pass `replaceUnreadable` to write anyway.
 */
export function setLedger(
  text: string,
  ledger: Ledger,
  options: SetLedgerOptions = {},
): TextChange[] {
  const existing = findLedger(text);
  if (
    existing &&
    !options.replaceUnreadable &&
    !readLedger(existing.source, existing.range).valid
  ) {
    throw new EditError(
      "The ledger at the end of this file can't be read, so Redlines won't change it. Fix or remove it first.",
    );
  }
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
