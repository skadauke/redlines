import { describe, expect, it } from 'vitest';
import { docsRoundTripNotes } from './notes.ts';

const FILE = (comments: string) => `Hello <!--cmt c8d2-->world<!--/c8d2-->.

<!-- redlines
version: 1
people:
  ada: {name: Ada}
comments:
${comments}
-->
`;

describe('docsRoundTripNotes', () => {
  it('says nothing for a file with one plain open comment', () => {
    const text = FILE('  c8d2: {by: ada, at: 2026-10-13T22:40Z, text: Hi}');
    expect(docsRoundTripNotes(text)).toEqual([]);
  });

  it('says replies and resolved threads are lost', () => {
    const text = FILE(
      [
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:40Z',
        '    text: Hi',
        '    resolved: true',
        '    replies:',
        '      - {id: r4fz, by: ada, at: 2026-10-13T22:45Z, text: Yes}',
        '      - {id: r5fz, by: ada, at: 2026-10-13T22:46Z, text: No}',
      ].join('\n'),
    );
    const notes = docsRoundTripNotes(text);
    expect(notes.map((n) => n.kind)).toEqual(['docs-replies', 'docs-resolved']);
    expect(notes[0]?.message).toContain('2 replies');
    expect(notes[1]?.message).toContain('1 resolved thread ');
  });
});
