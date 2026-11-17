# Vendored `@codemirror/collab`

This is `@codemirror/collab` 6.1.1 by Marijn Haverbeke, MIT licensed (`LICENSE` here). The package is
frozen, and CodeMirror has moved its repositories from GitHub to its own server, so Redlines keeps
its own copy. The source is
[`src/collab.ts` at tag 6.1.1](https://code.haverbeke.berlin/codemirror/collab) of
`https://code.haverbeke.berlin/codemirror/collab`.

- `upstream.ts` is that file, unchanged, under a header comment. Nothing but `collab.test.ts`
  imports it.
- `collab.ts` is that file with one fix. **The fix is the diff of `collab.ts` against
  `upstream.ts`** (`diff upstream.ts collab.ts`); every changed line is marked `// Redlines:`, apart
  from the header comment and the lines the fix replaces.

Both files keep upstream's formatting and carry `// @ts-nocheck` (the repository's strict settings
don't fit upstream's source), and the repository's ESLint and Prettier skip them.

The fix was found by the simulations in `docs/research/collaboration.md`: upstream composes
everything that was logged since a push's base into one change and maps the push over that, while a
client receiving the same updates maps its own edits over them in one go. Mapped over a
composition, an insertion can land differently from the same insertion mapped over each update in
turn, so the authority and a client can end with different text, and the client believes its edit was
confirmed. Here `rebaseUpdates` and `receiveUpdates` take one update at a time, so every side maps in
the same steps.

`collab.test.ts` reproduces the divergence against `upstream.ts` on pinned seeds, and shows that the
fix holds over 2,000 sessions.
