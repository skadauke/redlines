// @vitest-environment happy-dom
// Opening an empty item and leaving it is no edit (#439). Return then Tab at the end of an item
// makes an empty item under the item's text, which the file can't hold: it is open, out of the file
// (`getDoc()` is the document it started from), and taken back when the caret leaves. With Track
// Changes on the take-back rejects the Return's split, with its ledger entry; the format reads the
// nested bullet as the underline of the text above it, and a rejection in place joined the next
// paragraph into it (`- one⏎⏎Para.` gave `- onePara.`). The walks' invariants compare the file
// while the item is open with the file after leaving it, which both come from the same take-back,
// and can't see that: this holds the take-back to the file the item started from.
import { parse } from '@redlines/format';
import { expect, it } from 'vitest';
import {
  adjacentListsDocument,
  fuzzCount,
  listDocument,
  randomDocument,
  seeded,
} from '../../../format/src/random-docs.ts';
import { runScript, settle } from './script.ts';

const ITEM = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;

/** The ends of the lines of items, in the body, where the caret may stand. */
function itemEnds(doc: string): number[] {
  const end = parse(doc).ledgerRange?.from ?? doc.length;
  const found: number[] = [];
  let from = 0;
  for (const line of doc.slice(0, end).split('\n')) {
    const at = from + line.length;
    const before = doc.slice(0, at);
    if (ITEM.test(line) && before.lastIndexOf('<!--') <= before.lastIndexOf('-->')) found.push(at);
    from += line.length + 1;
  }
  return found;
}

const DOCUMENTS = fuzzCount(40);

it(`leaves the file it started from, in ${DOCUMENTS} random documents`, async () => {
  const failures: string[] = [];
  let opened = 0;
  for (let seed = 1; seed <= DOCUMENTS; seed++) {
    await settle();
    const random = seeded(seed);
    const doc =
      seed % 3 === 0
        ? adjacentListsDocument(random)
        : seed % 3 === 1
          ? listDocument(random)
          : randomDocument(random);
    const ends = itemEnds(doc);
    // Three places in each document, at most: where its items end.
    for (let k = 0; k < 3 && ends.length > 0; k++) {
      const at = ends.splice(Math.floor(random() * ends.length), 1)[0]!;
      const marked = doc.slice(0, at) + '‸' + doc.slice(at);
      for (const tc of [false, true]) {
        const name = `seed ${seed}, at ${at}, Track Changes ${tc ? 'on' : 'off'}`;
        const script = { name, doc: marked, keys: [], tc, expect: {} };
        const start = runScript(script).file;
        const tab = runScript({ ...script, keys: ['Enter', 'Tab'] });
        // Where Tab left an item open, the file is the one it started from, while it is open and
        // after leaving it.
        if (!tab.openItem) continue;
        opened++;
        if (tab.file !== start) {
          failures.push(`${name}: open, the file is ${JSON.stringify(tab.file.slice(0, 300))}`);
          continue;
        }
        const left = runScript({ ...script, keys: ['Enter', 'Tab', 'ArrowUp'] });
        if (left.file !== start) {
          failures.push(`${name}: leaving gave ${JSON.stringify(left.file.slice(0, 300))}`);
        }
      }
    }
  }
  expect(failures).toEqual([]);
  // Some of them opened an item, or this holds nothing.
  expect(opened).toBeGreaterThan(DOCUMENTS / 4);
}, 600_000);
