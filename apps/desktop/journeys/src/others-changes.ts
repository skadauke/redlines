// A document with others' changes, for the journeys of the simple look.

const LEDGER = `
<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
  b3nq: {by: bo, at: 2026-11-10T09:00Z}
  c4rt: {by: bo, at: 2026-11-10T09:01Z}
  d5sw: {by: ada, at: 2026-11-10T09:02Z}
  f6vx: {by: bo, at: 2026-11-10T09:03Z}
  g7zk: {by: ada, at: 2026-11-10T09:04Z}
  h8mn: {by: bo, at: 2026-11-10T09:05Z}
  k3sq: {by: ada, at: 2026-11-10T09:07Z}
comments:
  j2pq:
    by: ada
    at: 2026-11-10T09:06Z
    text: Is this right?
-->
`;

export const OTHERS_CHANGES =
  [
    '# Plan',
    '',
    'The launch is in <!--sub b3nq March-->April<!--/b3nq--> for the team<!--ins c4rt--> and its friends<!--/c4rt-->.<!--del d5sw  It will not slip.-->',
    '',
    'A <!--cmt j2pq-->second paragraph<!--/j2pq--> stays as it was.',
    '',
    '| Fruit | Count | Note |',
    '| ----- | ----- | ---- |',
    '| Apples | 3 | red |',
    '| <!--ins g7zk row--> Plums | 7 | blue |',
    '',
    '<!--del f6vx row=3 \\| Pears \\| 5 \\| green \\|-->',
    '',
    '<!--del k3sq Gone entirely, a whole paragraph.-->',
    '',
    'Last <!--del h8mn old -->line.',
    '',
  ].join('\n') + LEDGER;
