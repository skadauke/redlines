# Launch plan

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->

Every Redlines file is **valid Markdown**, so it opens anywhere, and its changes travel inside the file.

## Goals

1. Open any `.md` file and see a finished document.
2. Review changes the way people know from Word.
   - Accept or reject one change at a time, or all of one person’s.
3. Keep every change in the plain file.

> Markdown is the document format of AI. People get files from agents every day, and most apps show them as code.

## Timeline

| Milestone | What | When |
| --- | --- | --- |
| M1 | Format library and command line | November |
| M2 | Editor core | December |
| M3 | Desktop alpha | <!--sub r4tn January-->February<!--/r4tn--> |

<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
people:
  ada: {name: Ada Lovelace, email: ada@example.org}
  bo: {name: Bo Chen, email: bo@example.org}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-31T09:30Z}
  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: Matches the roadmap}
  w2rf: {by: bo, at: 2026-10-31T09:35Z}
  r4tn: {by: claude-ada, at: 2026-10-31T09:43Z, note: Two months of alpha before launch}
comments:
  c8d2:
    by: bo
    at: 2026-10-31T09:41Z
    replies:
      - id: r5tw
        by: claude-ada
        at: 2026-10-31T09:43Z
        text: |-
          Priya’s team. Their next review slot is the week of March 30.
    text: |-
      Who signs off on the security review?
-->
