// Rejecting a replacement whose old text holds other people's marks, where those marks can't stand at the
// top level as they are (a row's deletion line with typed text after it), is widened to the marks in the
// old text, which are rejected with it, not refused (#936).
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { reject, rejectAll } from './decide.ts';
import { parse } from './parse.ts';

const text =
  "<!--sub b7cd x y \\| \\| caf\u00e9 \\|\\n-\\- \\| -\\- \\| -\\- \\|\\n11 \\| caf\u00e9 \\| \\|\\nx y \\| caf\u00e9 \\| 1q1 \\|\\n\\| <!-\\-ins v6xz row-\\-> alpha \\| caf\u00e9 \\| alpha \\|\\n\\n<!-\\-del n3pq row=0 \\\\\\| alpha \\\\\\| caf\u00e9 \\\\\\| alpha \\\\\\|-\\->-->\n\nx y | | caf\u00e9 |\n-: | -- | -- |\n11<!--/b7cd-->ab<!--sub wpcp--> | caf\u00e9 | |\nx y | caf\u00e9 | 1q1 |\n| alpha | caf\u00e9 | alpha |\n<!--/wpcp-->\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bo: {name: Bo Chen}\n  claude-ada: {name: Claude, agent: true, for: ada}\nmarks:\n  b7cd: {by: ada, at: 2026-10-31T09:00Z}\n  v6xz: {by: claude-ada, at: 2026-10-31T09:00Z, move: n3pq}\n  n3pq: {by: claude-ada, at: 2026-10-31T09:00Z, move: v6xz}\n  wpcp: {by: ada, at: 2026-10-31T09:00Z}\n-->\n";
describe('rejecting a replacement beside the marks in its old text (#936)', () => {
  it('is not refused, and the marks that came back with it are rejected', () => {
    const after = applyChanges(text, reject(text, 'b7cd'));
    expect(parse(after).marks.map((mark) => mark.id)).toEqual(['wpcp']);
  });

  it('reject all is not refused either', () => {
    expect(() => rejectAll(text)).not.toThrow();
  });
});
