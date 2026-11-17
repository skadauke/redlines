import { parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import type { DocxModel } from './import/model.ts';
import { exportDocx } from './export/build.ts';
import { People } from './import/context.ts';
import { importDocx } from './import/import.ts';

// What the ledger keeps across .md to .docx to .md, where the file's own ledger is the source.

const file = (people: string[], comments: string[]) =>
  [
    'One <!--cmt c8d2-->first<!--/c8d2--> and <!--cmt c5x4-->second<!--/c5x4-->.',
    '',
    '<!-- redlines',
    'version: 1',
    'tracking: everyone',
    'people:',
    ...people,
    'comments:',
    ...comments,
    '-->',
    '',
  ].join('\n');

const ADA = '  ada: {name: Ada Lovelace}';
const BO = '  bo: {name: Bo Chen}';

describe('the ledger across the round trip', () => {
  it('gives each of two equal resolved threads its own resolver, in turn', async () => {
    const text = file(
      [ADA, BO],
      [
        '  c8d2:',
        '    by: ada',
        '    at: 2026-10-13T22:46Z',
        '    resolved: ada 2026-10-13T22:50Z',
        '    text: Same.',
        '  c5x4:',
        '    by: ada',
        '    at: 2026-10-13T22:46Z',
        '    resolved: bo 2026-10-13T22:51Z',
        '    text: Same.',
      ],
    );
    const back = importDocx(await exportDocx(text)).markdown;
    expect(Object.values(parse(back).ledger.comments).map((c) => c.resolved?.by)).toEqual([
      'ada',
      'bo',
    ]);
  });

  it('lists the people the file knew in its order, then the new ones as they were met', () => {
    const model = { people: [] } as unknown as DocxModel;
    const people = new People(model, [
      { handle: 'bo', name: 'Bo Chen' },
      { handle: 'ada', name: 'Ada Lovelace' },
    ]);
    people.handle('Cy Young');
    people.handle('Ada Lovelace');
    people.handle('Bo Chen');
    people.handle('Di Wu');
    expect(people.people().map((person) => person.handle)).toEqual([
      'bo',
      'ada',
      'cy-young',
      'di-wu',
    ]);
  });
});
