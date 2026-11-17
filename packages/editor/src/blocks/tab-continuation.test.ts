// @vitest-environment happy-dom
// An item whose marker is followed by a tab: CommonMark counts the tab to the next tab stop, so the
// item's content starts at column 4 (`1.<TAB>a`) or 2 (`-<TAB>a`), and a line indented by a tab (or by
// four spaces) under it is the item's second paragraph, not indented code (#453).
//
// micromark 4.0.2 reads:
//   `1.<TAB>a⏎⏎<TAB>b`   <ol><li><p>a</p><p>b</p></li></ol>
//   `-<TAB>a⏎⏎<TAB>b`    <ul><li><p>a</p><p>b</p></li></ul>
import { scriptRows } from './script.ts';

scriptRows(
  [true, false].flatMap((tc) => [
    {
      name: `Return at the end of the second paragraph of a tab-marker item, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '1.\ta⏎⏎\tb‸',
      keys: ['Enter'],
      tc,
      expect: { newest: '1.\ta⏎⏎\tb⏎2.\t' },
    },
    {
      name: `the same under a bullet, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '-\ta⏎⏎\tb‸',
      keys: ['Enter'],
      tc,
      expect: { newest: '-\ta⏎⏎\tb⏎-\t' },
    },
    {
      name: `four spaces under a tab marker, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '1.\ta⏎⏎    b‸',
      keys: ['Enter'],
      tc,
      expect: { newest: '1.\ta⏎⏎    b⏎2.\t' },
    },
    {
      name: `a space marker as the reference, Track Changes ${tc ? 'on' : 'off'}`,
      doc: '1. a⏎⏎\tb‸',
      keys: ['Enter'],
      tc,
      expect: { newest: '1. a⏎⏎\tb⏎2. ' },
    },
  ]),
);
