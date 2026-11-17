// A document with one of each of the changes that the exporter writes beyond the core: for the
// tests, and for the file that is opened in Word and Google Docs to see how they show it.

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAACtklEQVR4nA3Moc6uIACA4XM5JpPJvcFkMjATyREMzERyBgMzkRzB4EwkRzCwPxmJXtb5ngt4/n0FX8lX8dV8DV/L1/H1fJJv4Bv5Jj7DN/OtfBuf49v5Dr6LL/DdfA/fH/9yQS7JFbkmN+SW3JF7siQP5JE8kQ15Jq/kjezIO/kgX+RAvskP+Re9BW/JW/HWvA1vy9vx9rySd+AdeSdewzvzrrwbr+PdeQ/eizfw3rwP7y9KBakkVaSa1JBaUkfqSZI0kEbSRDKkmbSSNpIj7aSDdJEC6SY9pF8UC2JJrIg1sSG2xI7YEyVxII7EiWiIM3ElbkRH3IkH8SIG4k18iL8oFISSUBFqQkNoCR2hJ0jCQBgJE8EQZsJK2AiOsBMOwkUIhJvwEH7RWXCWnBVnzdlwtpwdZ88pOQfOkXPiNJwz58q5cTrOnfPgvDgD5835cP4iX+BLfIWv8Q2+xXf4Hi/xA37ET3iDn/ErfsM7/I4/8Bc+4G/8g/9FrsCVuApX4xpci+twPU7iBtyIm3AGN+NW3IZzuB134C5cwN24B/eLbIEtsRW2xjbYFtthe6zEDtgRO2ENdsau2A3rsDv2wF7YgL2xD/YXLQVLyVKx1CwNS8vSsfQskmVgGVkmFsMys6wsG4tj2VkOloslsNwsD8svMgWmxFSYGtNgWkyH6TESM2BGzIQxmBmzYjaMw+yYA3NhAubGPJhfpAt0ia7QNbpBt+gO3aMlekCP6Alt0DN6RW9oh97RB/pCB/SNftC/SBWoElWhalSDalEdqkdJ1IAaURPKoGbUitpQDrWjDtSFCqgb9aB+kSyQJbJC1sgG2SI7ZI+UyAE5IiekQc7IFbkhHXJHHsgLGZA38kH+IlEgSkSFqBENokV0iB4hEQNiREwIg5gRK2JDOMSOOBAXIiBuxIP44z/Du8+Ql+GrDgAAAABJRU5ErkJggg==';

const ledger = `<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
marks:
  r4wz: {by: ada, at: 2026-10-13T22:30Z}
  d3cf: {by: bo, at: 2026-10-13T22:31Z}
  k5cg: {by: ada, at: 2026-10-13T22:32Z}
  p7qd: {by: bo, at: 2026-10-13T22:33Z}
  b5bg: {by: ada, at: 2026-10-13T22:34Z}
  c6dh: {by: bo, at: 2026-10-13T22:35Z}
  m2bd: {by: ada, at: 2026-10-13T22:36Z}
  n3bd: {by: bo, at: 2026-10-13T22:37Z}
  q2hw: {by: ada, at: 2026-10-13T22:38Z}
  s3vb: {by: ada, at: 2026-10-13T22:39Z}
  j7mm: {by: bo, at: 2026-10-13T22:40Z}
  g5nb: {by: ada, at: 2026-10-13T22:41Z, group: g7nb}
  g6nb: {by: ada, at: 2026-10-13T22:41Z, group: g7nb}
  w2rf: {by: ada, at: 2026-10-13T22:43Z}
  t9vm: {by: bo, at: 2026-10-13T22:44Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:45Z
    about: w2rf
    text: Why did this go?
-->
`;

export const REST_SAMPLE = `# Export of the rest

## Tables

| Fruit  | Count | Price<!--fmt b5bg align=\\|\\x20-\\-\\-\\x20\\|\\x20-\\-\\-\\x20\\|\\x20-\\-\\-\\x20\\|--> |
| ------ | ----: | :---: |
| Apples | 3     | 1.20  |
| <!--ins r4wz row--> Pears | 5 | 0.90 |
| Plums  | <!--sub p7qd 7-->8<!--/p7qd--> | 2.00  |

<!--del d3cf row=2 \\| Cherries \\| 9 \\| 4.00 \\|-->

| Name | <!--ins k5cg col--> Origin |
| ---- | --- |
| Ada  | London |

## Formatting changes

Plain, then <!--fmt m2bd +bold-->**newly bold**<!--/m2bd--> text, and <!--fmt n3bd -italic-->no longer italic<!--/n3bd-->.

<!--fmt q2hw was=p-->

### This paragraph became a heading<!--/q2hw-->

## Splits and joins

A paragraph that was split in two<!--split s3vb-->

by a new break.

The first part<!--del j7mm \\n\\n-->and the second were joined.

## A move

Stays first.

<!--del g5nb Moves down.\\n\\n-->Stays second.

<!--ins g6nb-->Moves down.

<!--/g6nb-->Stays last.

## Images

An image: ![A small gradient](data:image/png;base64,${PNG}) and one that is not there: ![Chart of sales](https://example.org/sales.png).

## Comment on deleted text

Before <!--del w2rf these words were removed--> after.

## Task list

- [ ] not yet
- [x] checked<!--fmt c6dh +check-->
- [x] done

${ledger}`;
