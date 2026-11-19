// A delimiter typed beside a comment's or a highlight's marker with Track Changes off (#1140), and
// beside another person's pending change with it on (#1135, #1136): the file reads as its newest
// view in every order of decisions, judged by micromark (format §3.1, rule 5; docs/hardening.md).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { expectSound, readsAsNewest } from './oracle.ts';
import { ada, bodyOf, context, file } from './test-helpers.ts';
import { fineEdits, readsOtherAtBoundary, trackedEdits } from './track.ts';
import { untrackedEdit } from './untracked.ts';

const IDS = ['m2bd', 'n8fx', 'p7qd', 'q4wx', 'r5yz', 's6bc'];

describe('with Track Changes off, a delimiter beside a comment or a highlight marker (#1140)', () => {
  const type = (body: string, at: number, insert: string, ledger: Record<string, string> = {}) => {
    const before = file(body, ledger);
    return applyChanges(before, untrackedEdit(before, { from: at, to: at, insert }));
  };

  it('moves the highlight marker across the run, so that the delimiter stands against its word', () => {
    const body = 'foo*<!--hl k3x9-->bar<!--/k3x9-->';
    const after = type(body, body.length, '*', { k3x9: 'bo' });
    expect(bodyOf(after)).toBe('foo<!--hl k3x9-->*bar*<!--/k3x9-->');
    expect(readsAsNewest(after)).toBe(true);
    expectSound('hl', after);
  });

  it('writes the comment cases of the review as they were, which read alike', () => {
    for (const [body, at, expected] of [
      [
        '2*<!--cmt c8d2-->3<!--/c8d2--> and 4^5',
        '2*<!--cmt c8d2-->3<!--/c8d2--> and 4'.length,
        '2*<!--cmt c8d2-->3<!--/c8d2--> and 4*^5',
      ],
      [
        'xx*<!--cmt c8d2-->x<!--/c8d2-->',
        'xx*<!--cmt c8d2-->x<!--/c8d2-->'.length,
        'xx*<!--cmt c8d2-->x<!--/c8d2-->*',
      ],
    ] as const) {
      const after = type(body, at, '*');
      expect(bodyOf(after), body).toBe(expected);
      expect(readsAsNewest(after), body).toBe(true);
    }
  });
});

describe("a delimiter typed beside another person's change (#1135, #1136)", () => {
  const typed = (body: string, at: number, insert: string) => {
    const before = file(body, { k3x9: 'bo' });
    const changes = trackedEdits(before, [{ from: at, to: at, insert }], context(ada, IDS)).changes;
    return applyChanges(before, changes);
  };

  it('at the seam of a paragraph made of their insertion: the paragraph is replaced, every order reads alike', () => {
    const after = typed('x<!--ins k3x9-->*f*<!--/k3x9-->é', 1, '*');
    expect(bodyOf(after)).toBe(
      '<!--sub m2bd x<!-\\-ins k3x9-\\->*f*<!-\\-/k3x9-\\->é-->\n\nx**f*é<!--/m2bd-->',
    );
    expectSound('seam', after);
  });

  it('is told to the editor as the fine write that is replaced, as it is told to trackedEdits (#1301)', () => {
    // The editor types with `fineEdit` and asks `readsOtherAtBoundary` whether to replace the unit:
    // where `trackedEdits` replaces the paragraph at a seam, the answer is yes, or the editor writes
    // another file than the format library does (found by the depth run of the session harness).
    for (const [body, at, insert] of [
      ['x<!--ins k3x9-->*f*<!--/k3x9-->é', 1, '*'],
      ['x <!--fmt k3x9 +italic-->_f_<!--/k3x9-->', 2, '*'],
    ] as const) {
      const before = file(body, { k3x9: 'bo' });
      const edits = [{ from: at, to: at, insert }];
      const fine = fineEdits(before, edits, context(ada, IDS)).changes;
      const whole = trackedEdits(before, edits, context(ada, IDS)).changes;
      if (applyChanges(before, fine) === applyChanges(before, whole)) continue;
      expect(readsOtherAtBoundary(before, edits, fine), body).toBe(true);
    }
  });

  it('at the seam of their deletion, and in front of their italic with no letter between', () => {
    expectSound('deletion', typed('xa<!--del k3x9 *-->f y', 2, '*'));
    const italic = typed('x <!--fmt k3x9 +italic-->_f_<!--/k3x9-->', 2, '*');
    expect(bodyOf(italic)).toBe(
      'x <!--ins m2bd-->*<!--/m2bd--><!--fmt k3x9 +italic-->_f_<!--/k3x9-->',
    );
    expectSound('italic', italic);
  });

  it('a run with HTML tags pasted next to their bold, across a letter: the paragraph is replaced', () => {
    const target = 'x ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->éz';
    const after = typed(
      target,
      'x ca<!--fmt k3x9 +bold-->**f**<!--/k3x9-->'.length,
      '_bc_  </sub>___',
    );
    expect(bodyOf(after)).toMatch(/^<!--sub m2bd /);
    expectSound('paste', after);
  });
});

describe("a delimiter beside another person's pending italic (#1136, the review of #1301)", () => {
  const body = 'x ca<!--fmt k3x9 +italic-->_f_<!--/k3x9-->';
  const typedAt = (at: number, insert: string) => {
    const before = file(body, { k3x9: 'bo' });
    const changes = trackedEdits(before, [{ from: at, to: at, insert }], context(ada, IDS)).changes;
    return applyChanges(before, changes);
  };
  const whole = (text: string) =>
    `<!--sub m2bd x ca<!-\\-fmt k3x9 +italic-\\->_f_<!-\\-/k3x9-\\->-->\n\n${text}\n<!--/m2bd-->`;

  it('is replaced as the paragraph, whose new text spells the italic with `*` as the view does', () => {
    for (const [at, insert, written] of [
      [2, '*', whole('x *ca*f*')],
      [3, '*', whole('x c*a*f*')],
      [4, '*', whole('x ca**f*')],
      [27, '*', whole('x ca**f*')],
      [28, '*', whole('x ca**f*')],
      [4, '**', whole('x ca***f*')],
      [4, '~~', whole('x ca~~*f*')],
      [3, '</sub>*', whole('x c</sub>*a*f*')],
    ] as const) {
      const after = typedAt(at, insert);
      expect(bodyOf(after), `${insert} at ${at}`).toBe(written);
      expectSound(`${insert} at ${at}`, after);
    }
  });

  it('a pasted `</sub>*` just before its closing `_` is the known gap: written as the fine form, which reads otherwise (#1136)', () => {
    const after = typedAt(29, '</sub>*');
    expect(bodyOf(after)).toBe(
      'x ca<!--fmt k3x9 +italic-->_f<!--ins m2bd--></sub>*<!--/m2bd-->_<!--/k3x9-->',
    );
    expect(readsAsNewest(after)).toBe(false);
  });

  it('beside the word it is written as before, which reads alike', () => {
    for (const [at, insert] of [
      [1, '*'],
      [0, '**'],
      [2, '**'],
    ] as const) {
      expectSound(`${insert} at ${at}`, typedAt(at, insert));
    }
  });
});

describe('with Track Changes off, a marker is moved only on the line of the delimiter (#1301 review)', () => {
  it('a delimiter typed in the next list item leaves the highlight as it was', () => {
    const body = '- foo*<!--hl k3x9-->bar<!--/k3x9-->\n- baz';
    const before = file(body, { k3x9: 'bo' });
    const after = applyChanges(
      before,
      untrackedEdit(before, { from: body.length, to: body.length, insert: '*' }),
    );
    expect(bodyOf(after)).toBe('- foo*<!--hl k3x9-->bar<!--/k3x9-->\n- baz*');
  });

  it('a delimiter that is not the one beside the marker leaves it as it was', () => {
    const body = 'foo*<!--hl k3x9-->bar<!--/k3x9-->';
    const before = file(body, { k3x9: 'bo' });
    const after = applyChanges(
      before,
      untrackedEdit(before, { from: body.length, to: body.length, insert: '_' }),
    );
    expect(bodyOf(after)).toBe('foo*<!--hl k3x9-->bar_<!--/k3x9-->');
  });
});
