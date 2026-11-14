# The look review

Tests of behavior pass on a menu you can see through, white text on a light gray, a bullet that
jumps three pixels and a caret that lags. A person or an agent has to look. This is how.

## Collecting the pictures

```sh
pnpm journeys                  # the journeys that apply to your change (see README.md); shots are taken
JOURNEYS_PROJECTS=dark,light-200 pnpm journeys   # the same in the other looks, for what you changed
pnpm journeys:look             # → apps/desktop/journeys/look-review/INDEX.md and the pictures
```

`INDEX.md` lists every journey and its pictures in the order the journey took them, with the failed
comparisons first (the picture the run got, the approved one and the diff). In CI the whole folder is
the `look-review` artifact of the journeys job.

## The checklist

<!-- checklist -->
For each picture, in light and dark, and again at 200% where the change is about size:

1. **Readable.** Text has a contrast of at least 4.5:1 against what is behind it (3:1 for large
   text and icons), and nothing is clipped or cut at the window's edge.
2. **Opaque.** Menus, popups, hints and cards are solid: no text, line or selection shows through
   them. Nothing overlaps another thing's text.
3. **Aligned.** Edges and indents line up: bullets and numbers indent to the same place, a table's
   columns and its header, a menu's items and its icons, a caret and the text's baseline.
4. **Still.** Compare each picture with the one before it in the journey: nothing that should stay
   put moves (a line that jumps a few pixels when you start typing, a list that reflows, a margin
   that shifts), and anything that appears or goes has a reason.
5. **The caret.** It is where the next letter will go, as tall as the line, in the same place as the
   text it follows, and visible against the text and the selection.
6. **Hints say what a click does.** A hover hint names the action (and its key), is readable, and
   sits next to what it is about without covering it.
<!-- /checklist -->

## Reviewing

1. Read `INDEX.md` top to bottom; open each picture. Judge it against the six points; do not
   judge the app's design taste, only what is wrong.
2. A picture of a **known bug** (`known(issue, …)` in the journey) shows the bug on purpose: confirm
   it shows what the issue says, and don't file it again.
3. For each problem found: name the journey, the picture and which point of the list it breaks
   ("tables.spec.ts › the row grip menu is opaque, picture 2: the cell text shows through the menu,
   point 2"), and say what you would expect. A new problem that belongs to no open issue becomes an
   issue that mentions the Epic; one in a lane's own change is fixed before its PR is ready.
4. Say what you did **not** cover: the looks you didn't run, and the parts of the app the journeys
   don't reach (the app's own windows: `apps/desktop/scripts/app-windows`, see README.md).

## How a lane uses it

- **Before a PR is ready**, run the journeys for your change in light and dark, run `pnpm
  journeys:look`, and review against the list. Attach the pictures that show the change in a real
  flow to the PR (drag the PNGs into the description, or link the artifact), and write "look review:
  clean" or what you found and fixed.
- **A change to what people see adds a journey** (README.md, "Writing one") that takes a `j.shot()`
  at each moment worth seeing, and a `j.baseline()` only where a look must not change.
- **The sweep** runs everything in every look and reviews the whole folder.
