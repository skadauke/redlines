# Vendored `@codemirror/collab`

This is `@codemirror/collab` 6.1.1 by Marijn Haverbeke, MIT licensed (`LICENSE` here), rewritten as
TypeScript from the published `dist/index.js` (the package ships no source). The package is frozen
and its GitHub repository was archived in April 2026, so Redlines keeps its own copy.

One change, found by the simulations in `docs/research/collaboration.md`: upstream composes
everything that was logged since a push's base into one change and maps the push over that, while a
client receiving the same updates maps its own edits over them in one go. Mapped over a
composition, an insertion can land differently from the same insertion mapped over each update in
turn, so the authority and a client can end with different text, and the client believes its edit was
confirmed. Here `rebaseUpdates` and `receiveUpdates` take one update at a time, so every side maps in
the same steps.

`upstream.ts` keeps the two upstream functions, unchanged in behavior, for `collab.test.ts` to
reproduce the divergence against. Nothing else imports it.
