import { it } from 'vitest';
import { EditError } from './errors.ts';
import { file, randomIds, thread } from './test-helpers.ts';
import { untrackedEdit } from './untracked.ts';

it('find', () => {
  const found: string[] = [];
  const del = '<!--cmt c8d2--><!--del k3x9 **--><!--/c8d2-->';
  for (const [name, wrap] of [
    ['p', (c: string) => c],
    ['cell', (c: string) => `| a | b |\n| --- | --- |\n| c | ${c}`],
  ] as const) {
    for (const cell of [`*xy${del}`, `*x${del}`, `*xy ${del}`]) {
      const body = wrap(cell);
      const text = file(body, { k3x9: 'bo' }, thread('c8d2'));
      const base = body.indexOf(cell);
      for (let from = base; from < base + 5; from++) {
        for (let to = from; to < base + 5; to++) {
          for (const insert of ['ab', '']) {
            if (from === to && insert === '') continue;
            try {
              untrackedEdit(text, { from, to, insert }, { random: randomIds('w8nn') });
            } catch (error) {
              if (error instanceof EditError && /accepting the pending/.test(error.message)) {
                found.push(JSON.stringify([name, cell, from - base, to - base, insert]));
              }
            }
          }
        }
      }
    }
  }
  console.log('R', found.length, found.join('\n'));
});
