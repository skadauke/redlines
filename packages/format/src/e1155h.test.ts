import { it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';

it('italic positions', () => {
  const body = 'x ca<!--fmt k3x9 +italic-->_f_<!--/k3x9-->';
  const before = file(body, { k3x9: 'bo' });
  // source positions outside the marker
  const spots = [0, 1, 2, 3, 4, 27, 28, 29, 30, 42].filter((p) => p === 0 || p <= 4 || p === 27 || p === 30 || p === 42 || p === 28 || p === 29);
  for (const insert of ['*', '**', '~~', '</sub>*']) {
    for (const at of [0, 1, 2, 3, 4, 27, 28, 29, 30, 42]) {
      // skip positions inside a marker
      if (at > 4 && at < 27) continue;
      if (at > 30 && at < 42) continue;
      try {
        const done = trackedEdits(before, [{ from: at, to: at, insert }], context(ada, ['m2bd', 'n8fx', 'p7qd', 'q4wx', 'r5yz']));
        const after = applyChanges(before, done.changes);
        let ok = 'ok';
        try {
          expectSound('p', after);
        } catch (e) {
          ok = 'FAIL ' + String(e).slice(0, 200);
        }
        console.log('P', ok, insert, at, JSON.stringify(bodyOf(after)));
      } catch (e) {
        console.log('P THROW', insert, at, String(e).slice(0, 60));
      }
    }
  }
  void spots;
});
