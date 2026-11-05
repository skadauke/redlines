# Welcome to Redlines

Redlines shows every change to a Markdown file, the way Word shows tracked changes. The changes<!--ins k3x9--> and comments<!--/k3x9--> live inside the plain file, so it opens <!--sub p7qd in every Markdown editor-->anywhere<!--/p7qd--> and merges in git.<!--del w2rf  There is nothing else to install.-->

Each person’s changes have their own color, and <!--cmt c8d2-->agents such as Claude suggest changes in their own name<!--/c8d2-->.

## Try it

1. Turn on **Track Changes** under the pen at the top right (⇧⌘E), then type.
2. Press <!--hl h6bz-->Enter twice<!--/h6bz--> to start a new paragraph. After one Enter, the text goes on in the same paragraph.
3. Hover over a change to accept or reject it, or choose **Review changes** under the pen (⌥⌘])<!--ins m8dq--> to go through them one by one<!--/m8dq-->.
4. Reply to a comment from its note in the margin.
5. Switch between Clean, Redlines and Raw with the eye.

> Changes are kept until someone <!--sub r4tn decides-->accepts or rejects them<!--/r4tn-->, through every save, in any app.

## From the command line

Agents work on the same file with the `redlines` command line, and their suggestions show up here as they make them:

```sh
pnpm -s redlines str-replace /path/to/plan.md --old 'in March' --new 'in April' \
  --as claude-ada --name Claude --for ada --note 'The roadmap moved the launch'
```

Code blocks take their colors from the theme, whatever the language:

```ts
// Every change keeps its author.
export function accept(id: string, doc: Doc): Doc {
  const mark = doc.marks.find((m) => m.id === id);
  return mark ? { ...doc, text: apply(mark, doc.text) } : doc;
}
```

<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
people:
  ada: {name: Ada Lovelace, email: ada@example.org}
  bo: {name: Bo Chen, email: bo@example.org}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-31T09:30Z}
  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z, note: "It opens in any app, not only in editors"}
  w2rf: {by: bo, at: 2026-10-31T09:35Z}
  h6bz: {by: bo, at: 2026-10-31T09:38Z}
  m8dq: {by: bo, at: 2026-10-31T09:36Z}
  r4tn: {by: bo, at: 2026-10-31T09:37Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-31T09:41Z
    replies:
      - id: r5tw
        by: claude-ada
        at: 2026-10-31T09:43Z
        text: |-
          Yes. I can reply in a thread and suggest changes to the text it is about.
    quote: |-
      agents such as Claude suggest changes in their own name
    text: |-
      Can agents answer comments too?
-->
