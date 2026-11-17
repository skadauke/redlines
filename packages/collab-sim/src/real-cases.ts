// Cases the editor's writers and the format library's once wrote differently (#1094): the text an
// intent was made on, and the intent. `real.test.ts` holds the two to the same file.

import type { Intent } from './intents.ts';

export interface RealCase {
  label: string;
  text: string;
  intent: Intent;
}

export const REAL_CASES: RealCase[] = [
  {
    label: 'a replacement over a break between paragraphs, typed over its selection',
    text: "# u000 u001\n\nu002 u003 u004 u005 u006 u007 u008 u009 u010 u011\n\nu012 u013 u014 u015 u016 u017<!--ins z2zq--> ea000 ea001<!--/z2zq--> u018 u019 u020 u021\n\nu022 u023 u024 u025 u026 u027 u028 u029 u030 u031\n\nu032 u033 u034 u035 u036 u037 u038 u039 u040 u041\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada}\nmarks:\n  z2zq: {by: ada, at: 2026-11-16T09:00Z}\n-->\n",
    intent: {
      id: 'bo-0',
      author: { handle: 'bo', name: 'Bo' },
      time: '2026-11-16T09:00Z',
      seed: 512995246,
      at: 1000,
      body: { kind: 'sub', tokens: ['u021', 'u022', 'u023'], words: ['eb000', 'eb001'] },
    } as Intent,
  },
  {
    label:
      'a replacement inside text with a deleted bold, across a blank line (delimiters beside a break)',
    text: "# u000 u001\n\n<!--sub h5wt u002 u003 u004<!-\\-ins k29q-\\-> ec000 ec001 ec002<!-\\-/k29q-\\-> u005 u006 u007 u008 u009 u010 u011-->\n\n<!--del xs37 u002 u003 u004 **ec000-->\n\n ec001** ec002 u005 u006 u007 u008 u009 u010 u011<!--/h5wt-->\n\nu012 u013 u014 u015 u016 u017 u018 u019 u020 u021\n\nu022 u023 u024 u025 u026 u027 u028 u029 u030 u031\n\nu032 u033 u034 u035 u036 u037 u038 u039 u040 u041\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada}\n  bo: {name: Bo}\n  cy: {name: Cy}\nmarks:\n  h5wt: {by: ada, at: 2026-11-16T09:00Z}\n  k29q: {by: cy, at: 2026-11-16T09:00Z}\n  xs37: {by: bo, at: 2026-11-16T09:00Z}\n-->\n",
    intent: {
      id: 'cy-1',
      author: { handle: 'cy', name: 'Cy' },
      time: '2026-11-16T09:00Z',
      seed: 311533260,
      at: 5000,
      body: { kind: 'sub', tokens: ['ec001', 'ec002'], words: ['ec003'] },
    } as Intent,
  },
  {
    label: "typing beside another person's pending change (delimiters beside a break)",
    text: "# u000 u001\n\n<!--sub smzz u002 u003 u004<!-\\-ins rf4q-\\-> ec000<!-\\-/rf4q-\\-> <!-\\-del m844 u005 u006-\\-> u007 u008 u009 u010 u011<!-\\-ins nmx7-\\-> <!-\\-sub phf9 eb000-\\->ec001<!-\\-/phf9-\\-> eb001<!-\\-/nmx7-\\->-->\n\nu002 ea000 **u003<!--del dgvh  u004 ec000-->**  u007 u008 u009 u010 u011<!--/smzz--><!--ins bkvz--> eb002 eb003 eb004<!--/bkvz--><!--sub smzz--> ea001 ec001 eb001<!--/smzz-->\n\nu012 u013 u014 u015 u016 u017 u018 u019 u020 u021\n\nu022 u023 u024 u025 u026 u027 u028 u029 u030 u031\n\nu032 u033 u034 u035 u036 u037 u038 u039 u040 u041\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada}\n  bo: {name: Bo}\n  cy: {name: Cy}\nmarks:\n  smzz: {by: ada, at: 2026-11-16T09:00Z}\n  rf4q: {by: cy, at: 2026-11-16T09:00Z}\n  m844: {by: bo, at: 2026-11-16T09:00Z}\n  nmx7: {by: bo, at: 2026-11-16T09:00Z}\n  phf9: {by: cy, at: 2026-11-16T09:00Z}\n  dgvh: {by: cy, at: 2026-11-16T09:00Z}\n  bkvz: {by: bo, at: 2026-11-16T09:00Z}\n-->\n",
    intent: {
      id: 'ada-3',
      author: { handle: 'ada', name: 'Ada' },
      time: '2026-11-16T09:00Z',
      seed: 729415043,
      at: 9000,
      body: {
        kind: 'type',
        anchors: [
          { token: 'u003', side: 'after' },
          { token: 'u007', side: 'before' },
          { token: 'ea000', side: 'after' },
          { token: 'u008', side: 'before' },
          { token: 'u002', side: 'before' },
        ],
        words: ['ea002'],
      },
    } as Intent,
  },
  {
    label: 'a replacement beside a delimiter and a break',
    text: "# u000 u001\n\n<!--sub s6wq u002 u003 u004 u005<!-\\-ins p4z3-\\-> eb000<!-\\-/p4z3-\\-> u006 u007 <!-\\-del dxqc u008 u009-\\-> u010 u011\\n-->\n\nu002 u003 u004  eb000 u006<!--del q5tj  u007  **u010 u011-->**\n<!--/s6wq-->\nu012 u013 u014 u015 u016 u017 u018 u019 u020 u021\n\nu022 u023 u024 u025 u026 u027 u028 u029 u030 u031\n\nu032 u033 u034 u035 u036 u037 u038 u039 u040 u041\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada}\n  bo: {name: Bo}\n  cy: {name: Cy}\nmarks:\n  s6wq: {by: cy, at: 2026-11-16T09:00Z}\n  p4z3: {by: bo, at: 2026-11-16T09:00Z}\n  dxqc: {by: ada, at: 2026-11-16T09:00Z}\n  q5tj: {by: ada, at: 2026-11-16T09:00Z}\n-->\n",
    intent: {
      id: 'ada-2',
      author: { handle: 'ada', name: 'Ada' },
      time: '2026-11-16T09:00Z',
      seed: 343611704,
      at: 6000,
      body: { kind: 'sub', tokens: ['u004', 'eb000', 'u006'], words: ['ea000'] },
    } as Intent,
  },
  {
    label: "deleting the whole text of a bold that holds the author's own insertion",
    text: "# u000 u001\n\nu002 u003 u004 u005 u006<!--ins t3jd--> ea000 ea001<!--/t3jd--> <!--sub d5m5 u007 u008-->ea006 ea007<!--/d5m5--><!--ins ngdt--> ea003 ea004 ea005<!--/ngdt--> u009 u010 u011\n\nu012 u013 u014<!--ins dc3d--> eb001<!--/dc3d--> u015<!--ins wvtw--> ea002<!--/wvtw--> u016 u017 u018 u019 <!--fmt g6fx +bold-->**u020<!--ins p4ks--> eb002<!--/p4ks--> u021**<!--/g6fx-->\n\nu022 u023 u024 u025 u026 <!--fmt txjs +bold-->**u027 u028**<!--/txjs--> <!--del pwvs u029 u030--> u031\n\nu032 u033 u034 u035 u036<!--ins d8s7--> eb000<!--/d8s7--> u037 u038 u039 u040 u041\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada}\n  bo: {name: Bo}\n  cy: {name: Cy}\nmarks:\n  t3jd: {by: ada, at: 2026-11-16T09:00Z}\n  d5m5: {by: ada, at: 2026-11-16T09:00Z}\n  ngdt: {by: ada, at: 2026-11-16T09:00Z}\n  dc3d: {by: bo, at: 2026-11-16T09:00Z}\n  wvtw: {by: ada, at: 2026-11-16T09:00Z}\n  g6fx: {by: cy, at: 2026-11-16T09:00Z}\n  p4ks: {by: bo, at: 2026-11-16T09:00Z}\n  txjs: {by: cy, at: 2026-11-16T09:00Z}\n  pwvs: {by: cy, at: 2026-11-16T09:00Z}\n  d8s7: {by: bo, at: 2026-11-16T09:00Z}\n-->\n",
    intent: {
      id: 'bo-3',
      author: { handle: 'bo', name: 'Bo' },
      time: '2026-11-16T09:00Z',
      seed: 1370471545,
      at: 10000,
      body: { kind: 'delete', tokens: ['u020', 'eb002', 'u021'] },
    } as Intent,
  },
];
