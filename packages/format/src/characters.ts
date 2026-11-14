// Whole characters (#312). A character outside the first plane (an emoji, most often) is two UTF-16
// units. An edit that starts or ends between them, or types half of one, would write a lone
// surrogate, which a file can't hold and no tool reads back, and a marker can't stand between them:
// it is refused, in words. The editor never makes such an edit; a program that counts in code units
// can.

import { EditError } from './errors.ts';
import type { TextChange } from './types.ts';

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Throws an `EditError` where `edit` cuts a character in two or types half of one. */
export function assertWholeCharacters(text: string, edit: TextChange): void {
  const splits = (at: number) =>
    at > 0 &&
    at < text.length &&
    isHighSurrogate(text.charCodeAt(at - 1)) &&
    isLowSurrogate(text.charCodeAt(at));
  let lone = false;
  for (let i = 0; i < edit.insert.length; i++) {
    const unit = edit.insert.charCodeAt(i);
    if (isHighSurrogate(unit) && isLowSurrogate(edit.insert.charCodeAt(i + 1))) i++;
    else if (isHighSurrogate(unit) || isLowSurrogate(unit)) lone = true;
  }
  if (splits(edit.from) || splits(edit.to) || lone) {
    throw new EditError(
      'This change would cut a character in two: an emoji, and any other character outside the first plane, is two code units. Change it whole.',
      'no-legal-placement',
    );
  }
}
