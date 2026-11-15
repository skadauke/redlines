// @vitest-environment happy-dom
// The caret never rests in hidden text, in the shapes that put it there (#393, #461, #608): each a
// keystroke script held to every invariant of the suite, `hidden-caret` first.
import { describe, expect, it } from 'vitest';
import { invariantProblems, runScript, type Script, scriptRows } from './script.ts';

describe('the caret in front of the closers that end the body (#393)', () => {
  scriptRows([
    {
      // Shift-→ at the end of the body's text reaches the closer and the ledger after it, which
      // are hidden: the selection stops in front of the closer, not at the end of the body, which
      // is inside it.
      name: '#393: type, →, ⇧→ at the end of the last line',
      doc: 'One.⏎⏎Two.‸',
      keys: [{ type: 'x' }, 'ArrowRight', 'Shift-ArrowRight'],
      tc: true,
      expect: { file: 'One.⏎⏎Two.<ins>x</ins>', caret: 'One.⏎⏎Two.<ins>x‸</ins>' },
    },
    {
      name: '#393: ⇧→ at the end of the last line, Track Changes off',
      doc: 'One.⏎⏎Two.‸',
      keys: ['Shift-ArrowRight', 'Shift-ArrowRight'],
      tc: false,
      expect: {},
    },
  ]);

  // The walk's own shape, which holds hidden markers all over and lists: type, →, ⇧→, reject, reject.
  const { doc, at } = {
    doc: "- a-b <!--hl rm7w--><!--ins dcps--><!--sub nwzz beta end\\x2d-->qq caf\u00e9<!--/nwzz--> delta\n  e\u0301clair beta<!--/dcps--> a-b beta <!--ins v799-->`e\u0301clair` <!--sub v7hh \ud83d\ude00-->Ha-bO x gamma delta<!--/v7hh--> caf\u00e9 e\u0301clair<!--/v799--><!--/rm7w--> e\u0301clair x <!--ins xj54--><!--cmt h86s--><!--/xj54--> <!--cmt k83w-->delta delta <!--ins nm3c-->alpha<!--/k83w--> \ud83d\ude00<!--/nm3c-->\n- 42 <!--hl b9dh-->x<!--/b9dh--> <!--del v97n caf\u00e9 x a-\\-b-->\n\n- beta <!--del pf29 42--> beta\n- 42 a-b <!--cmt drws--><!--ins d397--><!--del vb5v delta x--> gamma a-b<!--/d397--> q<!--/drws--> <!--ins gzx4-->gamma a-b<!--/gzx4--> <!--cmt jbrt-->delta <!--ins nctn-->a-b<!--/jbrt--> x \ud83d\ude00<!--/nctn-->\n- a-b q `caf\u00e9`\n\n<!-- redlines\n# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bo: {name: Bo Chen}\n  claude-ada: {name: Claude, agent: true, for: ada}\nmarks:\n  rm7w: {by: ada, at: 2026-10-13T22:30Z}\n  dcps: {by: ada, at: 2026-10-13T22:30Z}\n  nwzz: {by: claude-ada, at: 2026-10-13T22:30Z}\n  v799: {by: bo, at: 2026-10-13T22:30Z}\n  v7hh: {by: ada, at: 2026-10-13T22:30Z}\n  xj54: {by: ada, at: 2026-10-13T22:30Z}\n  nm3c: {by: ada, at: 2026-10-13T22:30Z}\n  b9dh: {by: bo, at: 2026-10-13T22:30Z}\n  v97n: {by: bo, at: 2026-10-13T22:30Z}\n  pf29: {by: claude-ada, at: 2026-10-13T22:30Z}\n  d397: {by: claude-ada, at: 2026-10-13T22:30Z}\n  vb5v: {by: ada, at: 2026-10-13T22:30Z}\n  gzx4: {by: ada, at: 2026-10-13T22:30Z}\n  nctn: {by: bo, at: 2026-10-13T22:30Z}\ncomments:\n  h86s:\n    by: claude-ada\n    at: 2026-10-13T22:40Z\n    text: |-\n      A note.\n  k83w:\n    by: ada\n    at: 2026-10-13T22:40Z\n    text: |-\n      A note.\n  drws:\n    by: ada\n    at: 2026-10-13T22:40Z\n    quote: |-\n      e\u0301clair\n    text: |-\n      Is this q\\|r?\n  jbrt:\n    by: claude-ada\n    at: 2026-10-13T22:40Z\n    text: |-\n      A note.\n-->\n",
    at: 678,
  };
  it('the long document of the walk: type, →, ⇧→, reject, reject', () => {
    const keys = [
      { type: 'x' },
      'ArrowRight',
      'Shift-ArrowRight',
      { decide: 'reject' },
      { decide: 'reject' },
    ] as Script['keys'];
    const script: Script = {
      name: 'w',
      doc: doc.slice(0, at) + '‸' + doc.slice(at),
      keys,
      tc: true,
      expect: {},
    };
    const problems = invariantProblems(runScript(script, { light: true }));
    if (problems['hidden-caret']?.length)
      throw new Error(problems['hidden-caret'].join('\n').slice(0, 200));
  }, 60_000);
});

describe('Redo of a tracked deletion (#461)', () => {
  scriptRows([
    {
      name: '#461: ⌘Z and ⌘Y after the tracked deletion of a nested item’s text',
      doc: '- one⏎  - [x]',
      keys: ['Backspace', 'Mod-z', 'Mod-y'],
      tc: true,
      expect: { caret: '- one‸<del ⏎  - x>' },
    },
    {
      // A redo of a replacement at the end of the body stays in the body: the selection doesn't
      // reach through the hidden ledger.
      name: '#461: ⌘Z and ⌘Y of typing over a selection at the end of the body',
      doc: 'Hello [world]',
      keys: [{ type: 'q' }, 'Mod-z', 'Mod-y'],
      tc: true,
      expect: {},
    },
  ]);
});

describe('a redo stays in the body (#461)', () => {
  it('a selection of the replaced text ends before the hidden ledger', () => {
    const script: Script = {
      name: 'redo at the end',
      doc: 'Hello [world]',
      keys: [{ type: 'q' }, 'Mod-z', 'Mod-y'],
      tc: true,
      expect: {},
    };
    let reach = Number.POSITIVE_INFINITY;
    let ledger = 0;
    runScript(script, {
      light: true,
      onStep: (editor, i) => {
        if (i !== 2) return;
        const text = editor.view.state.doc.toString();
        ledger = text.indexOf('<!-- redlines');
        reach = editor.view.state.selection.main.to;
      },
    });
    expect(reach).toBeLessThanOrEqual(ledger);
  });
});
