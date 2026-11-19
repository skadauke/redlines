# Widgets: one look for hints, menus, cards, strips and buttons

The interface around the document is drawn in the theme's grays, never in color and never in the
system's black. Color marks people and the Track Changes pen alone (design §5.4). This page says
how each kind of floating widget is drawn, so that a new one looks like the rest. The tokens are
the theme's (`plugins/themes/src/tokens.css`); a widget names tokens and never a color of its own.

| Token                 | Is for                                                 |
| --------------------- | ------------------------------------------------------ |
| `--rl-card`           | the ground of every floating widget                    |
| `--rl-ink`            | its text                                               |
| `--rl-ink-2`, `-3`    | secondary text (shortcuts, addresses), and disabled    |
| `--rl-rule`           | its 1 px border, and a row's hover ground              |
| `--rl-shadow`         | its shadow                                             |
| `--rl-size-ui`        | its text, 13 px or more (14 px in the built-in themes) |
| `--rl-size-ui-small`  | a hint, caption or timestamp, 12 px or more            |

The `-scaled` and `-frame` forms of the sizes are for what follows the text size and for the title
bar (`AGENTS.md`). Never a size in em or %, and never under the floors
(`apps/desktop/src/interface-text.node.test.ts`).

## Hints

A hint says what a control does, and its shortcut. One style for all of them: the card ground,
`--rl-ink`, a 1 px `--rl-rule` border, `--rl-shadow`, a radius of 8 px, 6 to 7 px of padding above
and below and 10 px at the sides, at `--rl-size-ui-small`. The shortcut, or an address, is
`--rl-ink-2`. A hint shows after a pause of 400 ms on hover (`TOOLTIP_MS`; the icons' hints also show at once for
the keyboard's focus, a `title`'s only for the pointer); it never takes the pointer (`pointer-events: none`), and Escape puts it away.

- The title bar's icons, the review bar's icons, the table grips, the formatting palette and a
  link's address each have a hint of their own (`.rl-tip`, `.rl-hint`, `.rl-grip-hint`,
  `.rl-toolbar-tip`, `.rl-link-hint`), and the image's size readout (`.rl-image-badge`) is drawn the
  same.
- **A `title` attribute needs no code of its own.** The system draws it as a black bubble, so each
  window runs `installTitleHints` (`apps/desktop/src/ui/title-hints.ts`): while the pointer rests
  on an element with a `title`, the title is put away and the app's hint is shown, then the title is
  given back. Set `title` for a plain hint with no shortcut; build a hint element only where it
  needs a shortcut or a place of its own.
- Never a dark bubble, never white text, and never `--rl-tip` (retired). `hints.node.test.ts` reads
  every style source and fails on white text over a black ground, and holds each hint class above to
  the card, the ink, the rule and the small size.

## Menus and cards

The same ground, a 12 px radius, a 6 px inner padding and 14 px text (`.rl-menu`,
`.rl-notification`, the review panel). Rows are 28 px or more high and light up in `--rl-rule`. A
disabled row is `--rl-ink-3` and says why in its hint. Menus are opaque and sit above the text.
Notifications are the only widgets that stack at the lower right, and they never take the focus
(`apps/desktop/src/ui/notifications.ts`).

## Pills and strips

A pill (a change's bar, a person's name, a count) is a small rounded rectangle on `--rl-tint` or
`--rl-rule`, with `--rl-ink-2` text. A strip (the review bar, the find bar) is a card laid out in a
row, with icon buttons at a 28 px target. The only color in either is a person's author color, and
the pen's red.

The table's widgets follow it (`plugins/tables/src/grips.ts`): the + between rows and columns, the
strips at the table's edge and the select-table square are one widget, on `--rl-card` with a 1 px
`--rl-rule` border and a 6 px radius, `--rl-ink-2`, and under the pointer `--rl-pressed` and
`--rl-ink`. A handle's pill is `--rl-rule` with a `--rl-ink-2` border, and `--rl-pressed` with an `--rl-ink`
border under the pointer. A grip's menu is a menu as above (12 px radius, 32 px rows), and the row dragged is a card.

## The drop marker

Wherever something is dragged to a place between blocks (selected blocks, a table, a picture from the
sidebar or Finder, the rows of a table), the place is marked by one 3 px line in `--rl-drop`, a faint
blue, the one color that is neither a person's nor the pen's, in both themes. Where blocks are dragged
(`blocks/drag.ts`) a little room also opens there, 24 px at the theme's own text size, which grows in
0.14 s and appears at once when the system asks for reduced motion; the line stands in the middle of it.

## Buttons

An icon button is `--rl-ink-2` on no ground, `--rl-ink` and `--rl-rule` under the pointer and when
pressed. A card's one main action is the full ink on `--rl-pressed`. The keyboard's focus is a 2 px
ring in `--rl-ink-3` shown only for `:focus-visible`, so that a click never leaves a ring.
