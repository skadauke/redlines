// An insertion right before another person's tracked italic that starts with punctuation (#484):
// accepting it makes `é*<sup>` where the `*` can't open emphasis, and rejecting it leaves the italic.
// The edit is written so that every order of decisions reads alike, or it is refused, in the
// words that name the format change, and the file is as it was.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { EditError } from './errors.ts';
import { expectEveryOrderRead } from './oracle.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';

const attempt = (text: string, insert: string, at: number) => {
  try {
    const { changes } = trackedEdits(text, [{ from: at, to: at, insert }], context(ada, ['c2dd']));
    return applyChanges(text, changes);
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return error;
  }
};

describe('an insertion before a tracked italic that starts with punctuation (#484)', () => {
  for (const [label, body] of [
    ['a cell', '| <!--fmt k3x9 +italic-->*<sup>t u</sup>*<!--/k3x9--> |\n| :--: |\n| x |'],
    ['a paragraph', 'Intro <!--fmt k3x9 +italic-->*<sup>t u</sup>*<!--/k3x9--> end'],
  ] as const) {
    for (const insert of ['é', 'e', '7']) {
      it(`reads alike in every order, or is refused: ${label}, "${insert}"`, () => {
        const text = file(body, { k3x9: 'bo' });
        const at = text.indexOf('<!--fmt');
        const done = attempt(text, insert, at);
        if (done instanceof EditError) {
          expect(done.code).toBe('no-legal-placement');
          expect(done.message).toMatch(/format change/);
          return;
        }
        expectEveryOrderRead(`${label} ${insert}`, done);
      });
    }
  }
});
