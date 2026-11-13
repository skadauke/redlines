// Reading the ledger (format §5): finding the comment, parsing its YAML, and turning the result into
// a `Ledger`. Nothing here throws: a ledger that can't be read becomes an empty one and a warning.

import { parse as parseYaml } from 'yaml';
import { isId } from './ids.ts';
import { decodePayload } from './payload.ts';
import { scan } from './scan.ts';
import type { Scan } from './scan.ts';
import type {
  ExtraFields,
  Ledger,
  MarkEntry,
  Person,
  Range,
  Reply,
  Thread,
  Warning,
  WarningCode,
  YamlValue,
} from './types.ts';

/** Where the ledger comment sits in a file. */
export interface LedgerSpan {
  /** The comment, plus the blank line (or just the line break) before it: what adding the ledger
   * put in, and removing it takes away. The file's last line break, after it, is the body's. */
  range: Range;
  /** Where `<!-- redlines` starts. */
  start: number;
  /** The YAML between the first line and `-->`, with LF line endings. */
  source: string;
  /** Written with CRs alone for line breaks: a ledger that can't be read (format §5.1). */
  crLines?: true;
}

/** The line breaks in front of the ledger that are its own (format §5.1): the two LFs or two CRLFs
 * that make its blank line, or the one that another tool may leave (format §9.5). A CR in front of
 * them is the body's, a line break of its own and not half of a CRLF. Four characters hold the
 * longest, `\r\n\r\n`. */
const BLANK_LINE = /(\r?\n)\1$|\r?\n$/;

/** The blank line in front of a ledger written with CRs alone, which may be CRs too. */
const CR_BLANK_LINE = /(\r\n|\r|\n)\1$|(?:\r\n|\r|\n)$/;

/** The message of a ledger written with CRs alone for line breaks, as the app did before in a file
 * whose first line break is a CR. The app reads it, as it reads every line break, and writes it
 * again as the format does with the next edit. */
const CR_LINES =
  "The ledger's line breaks are CRs alone, which Redlines reads only in the app; an edit there writes them again";

/** The ledger is the last `<!-- redlines` … `-->` comment in the file, outside code (format §5.1).
 * Pass the file's `scan` if you have it. */
export function findLedger(text: string, scanned: Scan = scan(text)): LedgerSpan | null {
  const found = scanned.ledgers.at(-1);
  if (!found) return null;
  const front = text.slice(Math.max(0, found.start - 4), found.start);
  const breaks = (found.crLines ? CR_BLANK_LINE : BLANK_LINE).exec(front);
  const span: LedgerSpan = {
    range: { from: found.start - (breaks?.[0].length ?? 0), to: found.end + 3 },
    start: found.start,
    source: text.slice(found.headerEnd, found.end).replaceAll('\r\n', '\n'),
  };
  if (found.crLines) span.crLines = true;
  return span;
}

/** What reading the ledger of `span` gives: its YAML, read, or nothing for a ledger that was written
 * with CRs alone for line breaks. */
export function readSpan(span: LedgerSpan): LedgerRead {
  if (!span.crLines) return readLedger(span.source, span.range);
  return {
    ledger: emptyLedger(),
    warnings: [{ code: 'bad-ledger', message: CR_LINES, range: span.range }],
    valid: false,
  };
}

/** A ledger with nothing in it. */
export function emptyLedger(): Ledger {
  return { version: 1, people: [], marks: {}, comments: [] };
}

export interface LedgerRead {
  ledger: Ledger;
  warnings: Warning[];
  /** False when the YAML couldn't be read, so `ledger` is empty. */
  valid: boolean;
}

const TOP_KEYS = new Set(['version', 'tracking', 'view', 'history', 'people', 'marks', 'comments']);
/** Kept in `Ledger.extra` without a warning: used by a later version of Redlines (format §3.8). */
const KEPT_KEYS = new Set(['frontmatter']);
const PERSON_KEYS = new Set([
  'name',
  'email',
  'org',
  'accounts',
  'aliases',
  'agent',
  'for',
  'members',
  'deleted',
]);
const ENTRY_KEYS = new Set(['by', 'at', 'note', 'group', 'move', 'parts']);
const THREAD_KEYS = new Set([
  'by',
  'at',
  'about',
  'edited',
  'resolved',
  'assigned',
  'done',
  'likes',
  'reactions',
  'replies',
  'quote',
  'text',
]);
const REPLY_KEYS = new Set(['id', 'by', 'at', 'text']);

type Raw = Record<string, unknown>;

/** A key with nothing after it, which the `failsafe` schema reads as an empty string. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function isMap(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decodes a ledger string: the payload escapes, with a line holding only `\` standing for a blank
 * line (format §5.5). */
function decodeValue(value: string): string {
  return value
    .split('\n')
    .map((line) => (line === '\\' ? '' : decodePayload(line)))
    .join('\n');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? decodeValue(value) : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item: unknown) => str(item) ?? []);
  return items.length > 0 ? items : undefined;
}

function toYamlValue(value: unknown): YamlValue {
  if (typeof value === 'string') return decodeValue(value);
  if (Array.isArray(value)) return value.map(toYamlValue);
  if (isMap(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toYamlValue(v)]));
  return '';
}

/** `handle time`, as in `resolved` and `likes`. */
function byAt(value: string): { by: string; at: string } {
  const space = value.indexOf(' ');
  return space === -1
    ? { by: value, at: '' }
    : { by: value.slice(0, space), at: value.slice(space + 1) };
}

/** The YAML of the ledgers read last. A change, and the checks after it, read the same few ledgers
 * again and again, and reading YAML is most of the time a decision takes. What is kept is only read,
 * never changed: `readLedger` copies every value it uses. */
const yamlRead = new Map<string, { doc: unknown } | { error: unknown }>();
const YAML_KEPT = 64;

function yamlOf(source: string): unknown {
  let found = yamlRead.get(source);
  if (found === undefined) {
    try {
      found = {
        doc: parseYaml(source, { schema: 'failsafe', uniqueKeys: true, logLevel: 'error' }),
      };
    } catch (error) {
      found = { error };
    }
    if (yamlRead.size >= YAML_KEPT) yamlRead.clear();
    yamlRead.set(source, found);
  }
  if ('error' in found) throw found.error;
  return found.doc;
}

/** Reads the YAML inside a ledger comment. `range` is attached to the warnings. */
export function readLedger(source: string, range: Range): LedgerRead {
  const warnings: Warning[] = [];
  const warn = (code: WarningCode, message: string, id?: string) =>
    warnings.push(id === undefined ? { code, message, range } : { code, message, range, id });
  const fail = (message: string): LedgerRead => {
    warn('bad-ledger', message);
    return { ledger: emptyLedger(), warnings, valid: false };
  };

  let doc: unknown;
  try {
    doc = yamlOf(source);
  } catch (error) {
    const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    return fail(`The ledger is not valid YAML: ${reason}`);
  }
  if (doc === null || doc === undefined) return { ledger: emptyLedger(), warnings, valid: true };
  if (!isMap(doc)) return fail('The ledger is not a mapping');

  const ledger = emptyLedger();
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (ids.has(id)) warn('duplicate-id', `The id ${id} is used more than once in the ledger`, id);
    ids.add(id);
  };
  // Fields this version doesn't know are reported, and kept as they were read (format §5.2).
  const unknownFields: UnknownFields = (where, map, known) => {
    const found: [string, YamlValue][] = [];
    for (const [name, value] of Object.entries(map)) {
      if (known.has(name)) continue;
      warn('unknown-key', `The key ${name} in ${where} is not known and is kept`);
      found.push([name, toYamlValue(value)]);
    }
    return found.length > 0 ? Object.fromEntries(found) : undefined;
  };

  const version = str(doc['version']);
  if (version !== undefined && version !== '1')
    warn('bad-ledger', `Unsupported ledger version ${version}`);

  const tracking = str(doc['tracking']);
  if (tracking === 'everyone') ledger.tracking = 'everyone';
  else if (tracking !== undefined) warn('bad-ledger', `Unknown tracking setting ${tracking}`);

  const view = str(doc['view']);
  if (view === 'clean' || view === 'redlines') ledger.view = view;
  else if (view !== undefined) warn('bad-ledger', `Unknown view setting ${view}`);

  const history = str(doc['history']);
  if (history === 'full') ledger.history = 'full';
  else if (history !== undefined && history !== 'current') {
    warn('bad-ledger', `Unknown history setting ${history}`);
  }

  const people = doc['people'];
  if (isMap(people)) {
    for (const [handle, value] of Object.entries(people)) {
      ledger.people.push(readPerson(handle, value, warn, unknownFields));
    }
  } else if (!isBlank(people)) warn('bad-ledger', 'people is not a mapping');

  const marks = doc['marks'];
  const entries: [string, MarkEntry][] = [];
  if (isMap(marks)) {
    for (const [id, value] of Object.entries(marks)) {
      if (!isId(id)) {
        warn('orphan-entry', `${id} in marks is not a valid id and is ignored`, id);
        continue;
      }
      claim(id);
      entries.push([id, readEntry(id, value, warn, unknownFields)]);
    }
  } else if (!isBlank(marks)) warn('bad-ledger', 'marks is not a mapping');
  ledger.marks = Object.fromEntries(entries);

  const comments = doc['comments'];
  if (isMap(comments)) {
    for (const [id, value] of Object.entries(comments)) {
      if (!isId(id)) {
        warn('orphan-thread', `${id} in comments is not a valid id and is ignored`, id);
        continue;
      }
      claim(id);
      ledger.comments.push(readThread(id, value, warn, unknownFields, claim));
    }
  } else if (!isBlank(comments)) warn('bad-ledger', 'comments is not a mapping');

  const extra: [string, YamlValue][] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (TOP_KEYS.has(key)) continue;
    if (!KEPT_KEYS.has(key))
      warn('unknown-key', `The key ${key} in the ledger is not known and is kept`);
    extra.push([key, toYamlValue(value)]);
  }
  if (extra.length > 0) ledger.extra = Object.fromEntries(extra);

  return { ledger, warnings, valid: true };
}

type Warn = (code: WarningCode, message: string, id?: string) => void;
type UnknownFields = (where: string, map: Raw, known: Set<string>) => ExtraFields | undefined;

function readPerson(
  handle: string,
  value: unknown,
  warn: Warn,
  unknownFields: UnknownFields,
): Person {
  const map = isMap(value) ? value : {};
  if (!isMap(value)) warn('bad-ledger', `The person ${handle} is not a mapping`);
  const extra = unknownFields(`people.${handle}`, map, PERSON_KEYS);
  const name = str(map['name']);
  if (name === undefined && isMap(value)) warn('bad-ledger', `The person ${handle} has no name`);
  const person: Person = { handle, name: name ?? handle };
  const email = str(map['email']);
  if (email !== undefined) person.email = email;
  const org = str(map['org']);
  if (org !== undefined) person.org = org;
  const accounts = strings(map['accounts']);
  if (accounts) person.accounts = accounts;
  const aliases = strings(map['aliases']);
  if (aliases) person.aliases = aliases;
  if (str(map['agent']) === 'true') person.agent = true;
  const forHandle = str(map['for']);
  if (forHandle !== undefined) person.for = forHandle;
  const members = strings(map['members']);
  if (members) person.members = members;
  if (str(map['deleted']) === 'true') person.deleted = true;
  if (extra) person.extra = extra;
  return person;
}

function readEntry(
  id: string,
  value: unknown,
  warn: Warn,
  unknownFields: UnknownFields,
): MarkEntry {
  const map = isMap(value) ? value : {};
  if (!isMap(value)) warn('bad-ledger', `The entry for ${id} is not a mapping`, id);
  const extra = unknownFields(`marks.${id}`, map, ENTRY_KEYS);
  const by = str(map['by']);
  if (by === undefined && isMap(value)) warn('bad-ledger', `The entry for ${id} has no author`, id);
  const entry: MarkEntry = { by: by ?? 'unknown', at: str(map['at']) ?? '' };
  const note = str(map['note']);
  if (note !== undefined) entry.note = note;
  const group = str(map['group']);
  if (group !== undefined) entry.group = group;
  const move = str(map['move']);
  if (move !== undefined) entry.move = move;
  const parts = str(map['parts']);
  if (parts !== undefined) entry.parts = parts;
  if (extra) entry.extra = extra;
  return entry;
}

function readThread(
  id: string,
  value: unknown,
  warn: Warn,
  unknownFields: UnknownFields,
  claim: (id: string) => void,
): Thread {
  const map = isMap(value) ? value : {};
  if (!isMap(value)) warn('bad-ledger', `The thread ${id} is not a mapping`, id);
  const extra = unknownFields(`comments.${id}`, map, THREAD_KEYS);
  const thread: Thread = {
    id,
    by: str(map['by']) ?? 'unknown',
    at: str(map['at']) ?? '',
    likes: (strings(map['likes']) ?? []).map(byAt),
    replies: [],
    text: str(map['text']) ?? '',
  };
  const about = str(map['about']);
  if (about !== undefined) thread.about = about;
  const edited = str(map['edited']);
  if (edited !== undefined) thread.edited = edited;
  const resolved = str(map['resolved']);
  if (resolved !== undefined) thread.resolved = byAt(resolved);
  const assigned = str(map['assigned']);
  if (assigned !== undefined) thread.assigned = assigned;
  if (str(map['done']) === 'true') thread.done = true;
  const quote = str(map['quote']);
  if (quote !== undefined) thread.quote = quote;
  if (!isBlank(map['reactions'])) thread.reactions = toYamlValue(map['reactions']);

  const replies = map['replies'];
  if (Array.isArray(replies)) {
    for (const item of replies as unknown[]) {
      const replyId = isMap(item) ? str(item['id']) : undefined;
      if (!isMap(item) || replyId === undefined) {
        warn('bad-ledger', `A reply in ${id} has no id and is ignored`, id);
        continue;
      }
      const replyExtra = unknownFields(`comments.${id}.replies`, item, REPLY_KEYS);
      claim(replyId);
      const reply: Reply = {
        id: replyId,
        by: str(item['by']) ?? 'unknown',
        at: str(item['at']) ?? '',
        text: str(item['text']) ?? '',
      };
      if (replyExtra) reply.extra = replyExtra;
      thread.replies.push(reply);
    }
  }
  if (extra) thread.extra = extra;
  return thread;
}
