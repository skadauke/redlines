// A paste over cells that the format widens, as an intent (docs/research/multiuser.md §4.2): where
// the table's own rules refuse the rows and columns the paste needs (another person's change is
// in the table), the table is replaced, with the paste made in it (format §3.12). The paste is kept
// as what it was (the table, the values and where they go), with who, when and the bytes of the ids
// the format drew. `writeWidenedPaste` is the one place that writes it, and `deriveWidenedPaste`
// writes it again, on the text it was made on or, with the paste as it reads there, on newer text.

import { widenedPaste } from '@redlines/format';
import type {
  EditContext,
  MarkdownDialect,
  PasteOnTable,
  Person,
  TextChange,
} from '@redlines/format';
import { recording, replaying } from '../tracked/intent.ts';

export interface WidenedPasteIntent {
  kind: 'widened-paste';
  id: string;
  paste: PasteOnTable;
  author: Person;
  /** The dialect of the file it was written for (format §9.1). */
  dialect?: MarkdownDialect;
  /** To the minute. */
  time: string;
  drawn: readonly (readonly number[])[];
}

export interface WidenedPasteRequest {
  paste: PasteOnTable;
  author: Person;
  time: string;
  dialect?: MarkdownDialect;
  /** Where ids come from; none for the system's. */
  random?: (n: number) => Uint8Array;
}

/**
 * The widened paste of the request on `text`, and the intent that says how.
 *
 * @throws Untrackable when no unit holds it; EditError when the paste has no meaning on the table.
 */
export function writeWidenedPaste(
  text: string,
  request: WidenedPasteRequest,
): { changes: TextChange[]; intent: Omit<WidenedPasteIntent, 'id'> } {
  const { paste, author, time } = request;
  const drawing = recording(request.random);
  const ctx: EditContext = {
    author,
    time,
    random: drawing.random,
    ...(request.dialect === undefined ? {} : { dialect: request.dialect }),
  };
  const { changes } = widenedPaste(text, paste, ctx);
  return {
    changes,
    intent: {
      kind: 'widened-paste',
      paste,
      author,
      ...(request.dialect === undefined ? {} : { dialect: request.dialect }),
      time,
      drawn: drawing.drawn,
    },
  };
}

/**
 * The changes an intent makes on `text`: what it wrote the first time, on the text it was made on.
 * On newer text, `paste` is the paste as it reads there.
 *
 * @throws Untrackable when no unit holds it there; EditError when the paste has no meaning there.
 */
export function deriveWidenedPaste(
  text: string,
  intent: WidenedPasteIntent,
  paste: PasteOnTable = intent.paste,
): TextChange[] {
  return writeWidenedPaste(text, {
    paste,
    author: intent.author,
    time: intent.time,
    ...(intent.dialect === undefined ? {} : { dialect: intent.dialect }),
    random: replaying(intent),
  }).changes;
}
