// Random keys in code, math and raw text after other people's changes (format §3.5, rule 9): Bo's
// and Ada's operations in a document of code blocks in every container, then a key of Ada's or Bo's
// inside a block. Whatever is written reads alike in every order of decisions, rejecting everything
// gives the file before the key back, and no marker lands inside a block (an edit that would put
// one there is refused).

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { fuzzCount, seeded } from './random-docs.ts';
import { ada, bo, bodyOf, context, expectEveryOrderAlike, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import type { Person } from './types.ts';

const FIRST = 'bcdfghjkmnpqrstvwxz';
const REST = 'bcdfghjkmnpqrstvwxz23456789';

describe('random keys in code after other people’s changes', () => {
  it('read alike in every order of decisions, and reject to the file before', () => {
    const total = fuzzCount(300);
    const bad: string[] = [];
    for (let seed = 1; seed <= total; seed++) {
      const r = seeded(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
      const ids = [
        ...new Set(
          Array.from(
            { length: 40 },
            () =>
              FIRST[Math.floor(r() * FIRST.length)]! +
              Array.from({ length: 3 }, () => REST[Math.floor(r() * REST.length)]).join(''),
          ),
        ),
      ];
      const codeKinds = [
        (p: string) => `${p}\`\`\`js\n${p}let a = 1;\n${p}\n${p}let b = 2;\n${p}\`\`\``,
        (p: string) => `${p}~~~\n${p}x\n${p}~~~`,
        (p: string) => `${p}\`\`\`\`\n${p}\`\`\`js\n${p}y\n${p}\`\`\`\n${p}\`\`\`\``,
        (p: string) => `${p}\`\`\`{r}\n${p}plot(x)\n${p}\`\`\``,
        (p: string) => `${p}$$\n${p}x = 1\n${p}y\n${p}$$`,
        (p: string) => `${p}$$x = 1$$`,
        (p: string) => `${p}<pre>\n${p}one\n${p}\n${p}two\n${p}</pre>`,
        (p: string) => `${p}<title>Doc one</title>`,
      ];
      const blocks: string[] = [];
      const count = 2 + Math.floor(r() * 4);
      for (let i = 0; i < count; i++) {
        const k = r();
        const where = r();
        if (k < 0.45) {
          const code = pick(codeKinds);
          // Raw text in a quote or a list item is not found by the scan (it starts a line at the left
          // edge): the ordinary engine writes its line breaks, as on main.
          const raw = /<(?:pre|title)/.test(code(''));
          if (where < 0.6 || raw) blocks.push(code(''));
          else if (where < 0.8) blocks.push('> intro text here.\n>\n' + code('> '));
          else blocks.push('- item one text\n\n' + code('  ') + '\n\n- item two');
        } else if (k < 0.55) blocks.push('    indented one\n    indented two');
        else if (k < 0.8) blocks.push(`Paragraph ${i} with some words in it.`);
        else if (k < 0.9) blocks.push(`- list a${i}\n- list b${i}`);
        else blocks.push(`## Head ${i}`);
      }
      let text = file(blocks.join(r() < 0.8 ? '\n\n' : '\n'));
      try {
        if (parse(text).warnings.length) continue;
      } catch {
        continue;
      }
      const history: string[] = [bodyOf(text)];
      const operate = (who: Person, kind: number) => {
        const body = bodyOf(text);
        const at = Math.floor(r() * body.length);
        const edit =
          kind === 0
            ? { from: at, to: at, insert: pick(['x', 'ab', '\n', ' ']) }
            : kind === 1
              ? { from: at, to: Math.min(body.length, at + 1 + Math.floor(r() * 5)), insert: '' }
              : { from: at, to: at, insert: '\n\n' };
        try {
          const result = trackedEdits(text, [edit], context(who, ids.splice(0, 6)));
          text = applyChanges(text, result.changes);
          history.push(`[${who.handle} ${JSON.stringify(edit)}]\n${bodyOf(text)}`);
        } catch (error) {
          if (!(error instanceof EditError) && !/ran out/.test(String(error))) throw error;
        }
      };
      for (let i = Math.floor(r() * 4); i > 0; i--) {
        operate(r() < 0.8 ? bo : ada, Math.floor(r() * 3));
      }
      const before = bodyOf(text);
      const lines = [
        ...before.matchAll(/(?:let a = 1;|plot\(x\)|x = 1|one|y|indented one|\nx\n|Doc)/g),
      ];
      // Not in a marker's payload: only text the document shows.
      const markers = [...before.matchAll(/<!--[^]*?-->/g)].map((m) => [
        m.index,
        m.index + m[0].length,
      ]);
      const shown = lines.filter(
        (line) => !markers.some(([a, b]) => line.index >= a! && line.index < b!),
      );
      const hit = shown.length > 0 ? pick(shown) : undefined;
      if (!hit) continue;
      const at = hit.index + Math.floor(r() * (hit[0].length + 1)) - (r() < 0.2 ? 1 : 0);
      const edit = pick([
        { from: at, to: at, insert: 'Q' },
        { from: at, to: at, insert: '\n' },
        { from: at, to: Math.min(before.length, at + 1), insert: '' },
        { from: at, to: at, insert: '  ' },
        { from: at, to: at, insert: ' ' },
      ]);
      const who = r() < 0.15 ? bo : ada;
      let after: string;
      try {
        after = applyChanges(
          text,
          trackedEdits(text, [edit], context(who, ids.splice(0, 6))).changes,
        );
      } catch (error) {
        if (error instanceof EditError) continue;
        bad.push(`seed ${seed}: threw ${String(error)}`);
        continue;
      }
      let message = '';
      let rejected = '';
      let rejectedBefore: string;
      try {
        rejectedBefore = bodyOf(applyChanges(text, rejectAll(text)));
      } catch {
        continue;
      }
      try {
        rejected = bodyOf(applyChanges(after, rejectAll(after)));
      } catch (error) {
        message += ` REJECT-ALL-THROWS ${String(error).slice(0, 80)}`;
      }
      const norm = (s: string) =>
        s
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]+$/gm, '')
          .replace(/\s+$/, '');
      if (norm(rejected) !== norm(rejectedBefore)) message += ' REJECT-DIFFERS';
      try {
        expectEveryOrderAlike(`seed ${seed}`, after);
      } catch (error) {
        message += ` NOT-ALIKE ${String(error).slice(0, 160)}`;
      }
      if (message) {
        bad.push(
          `seed ${seed}:${message}\n${history.join('\n~~\n')}\n--- before\n${before}\n--- ${JSON.stringify(edit)} by ${who.handle}\n--- after\n${bodyOf(after)}`,
        );
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
  }, 600_000);
});
