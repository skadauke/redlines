// The sheet of every interface element (#1208), as the journey sees it: each specimen is an element
// the app draws, the states it can be in, and how a person gets it there. The page
// (apps/desktop/src/sheet-check.ts) draws the document and the notifications; the journey takes
// each specimen through its states with the real mouse and keys, reads its computed style and takes
// its screenshot, and then holds families of siblings to agree (`FAMILIES`, judged by `disagreements`
// against `KNOWN`).

import type { Locator, Page } from '@playwright/test';
import type { Journey } from './journey.ts';

export type State = 'rest' | 'hover' | 'keys' | 'selected' | 'dragged';
export const STATES: readonly State[] = ['rest', 'hover', 'keys', 'selected', 'dragged'];

/** What of an element's style is read, as the computed style names it. */
export const PROPS = [
  'width',
  'height',
  'borderTopLeftRadius',
  'backgroundColor',
  'color',
  'boxShadow',
  'borderTopColor',
  'borderTopWidth',
  'outlineStyle',
  'outlineWidth',
  'outlineColor',
  'opacity',
] as const;
export type Prop = (typeof PROPS)[number];
export type Style = Record<Prop, string>;

export interface Specimen {
  /** A short name, which is also its screenshot's name. */
  name: string;
  /** The family of siblings it is held to (see FAMILIES). */
  family: string;
  /** Finds it, once a state is reached. */
  selector: string;
  /** Finds it in a state, when the state is a style of the element (`:hover`, `:focus-visible`). */
  selectorFor?: Partial<Record<State, string>>;
  /** Read its `::before` or `::after`, where the drawn part is the pseudo-element. */
  pseudo?: '::before' | '::after';
  /**
   * How a person brings it to a state; a state missing here is one this element doesn't have.
   * Each leaves the element drawn, in that state, and the mouse where it holds it.
   */
  reach: Partial<Record<State, (j: Journey) => Promise<void>>>;
  /** What to take the picture of instead of the element itself (the menu a row is in). */
  frame?: string;
  /** The views it is drawn in; by default all three. */
  views?: readonly string[];
  /** States in which it may be gone (the element a drag takes up is replaced by a ghost). */
  mayVanish?: readonly State[];
  /** Puts the page back after its states (a sidebar that was opened is closed). */
  after?: (j: Journey) => Promise<void>;
}

const AWAY = { x: 5, y: 5 };

/** The page back at rest: no menu, no selection of a picture, the mouse off everything. */
async function rest(j: Journey): Promise<void> {
  await j.page.keyboard.press('Escape');
  // Esc may have taken a notification away: the sheet puts them up again.
  await j.page.evaluate(() =>
    (window as unknown as { __REDLINES_SHEET__?: { notify(): void } }).__REDLINES_SHEET__?.notify(),
  );
  await j.page.mouse.move(AWAY.x, AWAY.y);
  await j.settle();
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not drawn');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Points the mouse at an element: it is hovered. */
async function pointAt(j: Journey, locator: Locator) {
  const at = await centerOf(locator);
  await j.page.mouse.move(at.x, at.y, { steps: 4 });
  return at;
}

/** Presses on an element and moves a little, and does not let go (the next state's `release` does). */
async function dragFrom(j: Journey, locator: Locator, by: { x: number; y: number }) {
  const at = await centerOf(locator);
  await j.page.mouse.move(at.x, at.y, { steps: 3 });
  await j.page.mouse.down();
  await j.page.mouse.move(at.x + by.x, at.y + by.y, { steps: 6 });
}

export async function release(page: Page): Promise<void> {
  await page.mouse.up();
}

const img = (j: Journey) => j.page.locator('.rl-image img').first();

const imageHover = async (j: Journey) => {
  await rest(j);
  await pointAt(j, img(j));
};
const imageSelected = async (j: Journey) => {
  await rest(j);
  await img(j).click();
  await j.page.mouse.move(AWAY.x, AWAY.y);
  await j.settle();
};

/** Hovers a cell of the table, which draws its grips. */
const overCell = (text: string) => async (j: Journey) => {
  await rest(j);
  const at = await j.pointOf(text);
  await j.page.mouse.move(at.x + 6, at.y, { steps: 4 });
  await j.settle();
};

/** Opens the eye's menu from the keyboard, so that no row is under the pointer or has the focus. */
const openEye = async (j: Journey) => {
  await rest(j);
  // The menu opens when the pointer rests on the button and shuts when it leaves, so at rest the
  // pointer is on the button, and no row is under it.
  await j.page.getByRole('button', { name: 'View', exact: true }).hover();
  await j.page.locator('.rl-menu-item').filter({ visible: true }).first().waitFor();
};

/** The eye's menu, with the first row chosen by the keys. */
const eyeWithKeys = async (j: Journey) => {
  await rest(j);
  await j.page.getByRole('button', { name: 'View', exact: true }).focus();
  await j.page.keyboard.press('ArrowDown');
  await j.page.locator('.rl-menu-item').filter({ visible: true }).first().waitFor();
  // One that isn't the current view (that one is the menu's "selected" row, which is drawn apart).
  await j.page.locator('.rl-menu-item').filter({ visible: true }).nth(2).focus();
};

/** The palette, from a right-click on the paragraph, with its Format menu open. */
const openPalette = async (j: Journey) => {
  await rest(j);
  await j.page.getByText('A paragraph with').first().click({ button: 'right' });
  await j.page.locator('.rl-toolbar-top', { hasText: 'Format' }).click();
  await j.page.locator('.rl-toolbar-item').filter({ visible: true }).first().waitFor();
  await j.page.mouse.move(AWAY.x, AWAY.y);
};

/** The grip menu, from a right-click on the first row's grip. */
const openGripMenu = async (j: Journey) => {
  await overCell('1')(j);
  await j.page.locator('.rl-grip').click({ button: 'right' });
  await j.page.locator('.rl-grip-item').first().waitFor({ state: 'visible' });
  await j.page.mouse.move(AWAY.x, AWAY.y);
};

/** The keyboard has chosen an item: focus comes to it after a key, so that `:focus-visible` holds. */
const chooseWithKeys = (items: string) => async (j: Journey) => {
  await j.page.keyboard.press('Shift');
  await j.page.locator(items).filter({ visible: true }).nth(2).focus();
};

const hoverItem = (items: string) => async (j: Journey) => {
  await pointAt(j, j.page.locator(items).filter({ visible: true }).nth(2));
};

// ----- Part 2: the review, the callout, the find bar, the sidebar, the outline, the Quarto chips -----

/** A change's card, from a click on the insertion. */
const openCard = async (j: Journey) => {
  await rest(j);
  await j.page.getByText('insertion').first().click();
  await j.page.locator('.rl-card').filter({ visible: true }).first().waitFor();
  await j.page.mouse.move(AWAY.x, AWAY.y);
};

/** The callout's menu: its button, and the popover a click on it opens. */
const openCalloutMenu = async (j: Journey) => {
  await rest(j);
  const button = j.page.locator('.rl-callout-menu').first();
  await pointAt(j, j.page.locator('.rl-callout-head').first());
  await button.click();
  await j.page.locator('.rl-callout-item').filter({ visible: true }).first().waitFor();
  await j.page.mouse.move(AWAY.x, AWAY.y);
};

/** The find bar, from ⌘F in the document. */
const openFind = async (j: Journey) => {
  await rest(j);
  await j.page.locator('.cm-content').click();
  await j.page.keyboard.press('Meta+f');
  await j.page.locator('.rl-find-bar').waitFor({ state: 'visible' });
  await j.page.mouse.move(AWAY.x, AWAY.y);
};

/** The sidebar's list of files, from the button that opens it. */
const openSidebar = async (j: Journey) => {
  await rest(j);
  // The button says which it is: Show files, or Hide files.
  const show = j.page.getByRole('button', { name: 'Show files' });
  if (await show.count()) await show.click();
  await j.page.getByRole('button', { name: 'Hide files' }).waitFor();
  await j.page.waitForTimeout(250);
};
const closeSidebar = async (j: Journey) => {
  const hide = j.page.getByRole('button', { name: 'Hide files' });
  if (await hide.count()) await hide.click();
  await j.page.getByRole('button', { name: 'Show files' }).waitFor();
};

/** The outline's list of headings, from the pointer on its ticks. */
const openOutline = async (j: Journey) => {
  await rest(j);
  await j.page.locator('.rl-outline-panel').first().hover();
  await j.page.locator('.rl-outline-item').filter({ visible: true }).first().waitFor();
};

/** A specimen that is a button or a row, reached in `rest`, `hover` and `keys` by the same moves. */
function pressable(
  name: string,
  family: 'buttons' | 'rows',
  selector: string,
  open: (j: Journey) => Promise<void>,
  more: Partial<Specimen> = {},
): Specimen {
  const nth = (j: Journey) => {
    const items = j.page.locator(selector).filter({ visible: true });
    return family === 'rows' ? items.first() : items.last();
  };
  return {
    name,
    family,
    selector,
    selectorFor: { hover: `${selector}:hover`, keys: `${selector}:focus-visible` },
    reach: {
      ...(more.selectorFor?.selected ? { selected: open } : {}),
      rest: open,
      hover: async (j) => {
        await open(j);
        await nth(j).hover({ force: true });
      },
      keys: async (j) => {
        await open(j);
        await j.page.keyboard.press('Shift');
        await nth(j).focus();
      },
    },
    ...more,
  };
}

const MORE: readonly Specimen[] = [
  // The change card and its buttons; the bar beside the change.
  {
    name: 'change-card',
    family: 'cards',
    selector: '.rl-card',
    views: ['redlines', 'simple'],
    reach: {
      rest: openCard,
      hover: async (j) => {
        await openCard(j);
        await pointAt(j, j.page.locator('.rl-card').filter({ visible: true }).first());
      },
    },
  },
  pressable('card-button', 'buttons', '.rl-card-button', openCard, {
    views: ['redlines', 'simple'],
  }),
  {
    name: 'change-bar',
    family: 'bars',
    selector: '.rl-bar-seg',
    views: ['redlines', 'simple'],
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator('.rl-bar-seg').first());
      },
      selected: async (j) => {
        await rest(j);
        await j.page.locator('.rl-bar-seg').first().click({ force: true });
        await j.page.mouse.move(AWAY.x, AWAY.y);
      },
    },
  },
  // The callout's menu.
  pressable('callout-menu-button', 'buttons', '.rl-callout-menu', rest),
  {
    name: 'callout-popover',
    family: 'cards',
    selector: '.rl-callout-popover',
    reach: { rest: openCalloutMenu },
  },
  pressable('callout-item', 'rows', '.rl-callout-item', openCalloutMenu, {
    frame: '.rl-callout-popover',
  }),
  // The find bar and its toggles.
  { name: 'find-bar', family: 'cards', selector: '.rl-find-bar', reach: { rest: openFind } },
  pressable('find-toggle', 'buttons', '.rl-find-toggle', openFind, { frame: '.rl-find-bar' }),
  // The sidebar's files and the outline's headings.
  pressable('sidebar-item', 'rows', '.rl-sidebar-item', openSidebar, {
    selectorFor: {
      rest: '.rl-sidebar-item:not(:hover):not([aria-current="page"])',
      hover: '.rl-sidebar-item:hover',
      keys: '.rl-sidebar-item:focus-visible',
      selected: '.rl-sidebar-item[aria-current="page"]',
    },
    after: closeSidebar,
    frame: '.rl-sidebar-list',
  }),
  {
    ...pressable('outline-item', 'rows', '.rl-outline-item', openOutline, {
      selectorFor: {
        rest: '.rl-outline-item:not(:hover)',
        hover: '.rl-outline-item:hover',
        keys: '.rl-outline-item:focus-visible',
      },
      frame: '.rl-outline-panel',
    }),
    // No `hover`: a scripted pointer never lands on a row before the panel shuts (listed in the PR).
    reach: {
      rest: openOutline,
      keys: async (j) => {
        await openOutline(j);
        await j.page.keyboard.press('Shift');
        await j.page.locator('.rl-outline-item').first().focus();
      },
    },
  },
  // The Quarto chips, in a Quarto file.
  ...(
    [
      ['reference-chip', '.rl-xref'],
      ['citation-chip', '.rl-cite'],
    ] as const
  ).map(([name, selector]): Specimen => ({
    name,
    family: 'chips',
    selector,
    views: ['clean', 'simple'],
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator(selector).first());
      },
      selected: async (j) => {
        await rest(j);
        await j.page.locator(selector).first().click();
        await j.page.mouse.move(AWAY.x, AWAY.y);
      },
    },
  })),
];

export const SPECIMENS: readonly Specimen[] = [
  // ----- Handles: the picture's, and the table's -----
  {
    name: 'picture-handle',
    family: 'handles',
    selector: '.rl-image-handle-right',
    pseudo: '::before',
    reach: {
      rest,
      hover: imageHover,
      selected: imageSelected,
      dragged: async (j) => {
        await imageSelected(j);
        await img(j).hover();
        await dragFrom(j, j.page.locator('.rl-image-handle-right'), { x: -30, y: 0 });
      },
    },
  },
  {
    name: 'row-grip',
    family: 'handles',
    selector: '.rl-grip',
    pseudo: '::before',
    mayVanish: ['dragged'],
    reach: {
      rest: overCell('1'),
      hover: async (j) => {
        await overCell('1')(j);
        await pointAt(j, j.page.locator('.rl-grip'));
      },
      selected: async (j) => {
        await overCell('1')(j);
        await j.page.locator('.rl-grip').click();
        await j.page.mouse.move(AWAY.x, AWAY.y);
        await overCell('1')(j);
      },
      dragged: async (j) => {
        await overCell('1')(j);
        await dragFrom(j, j.page.locator('.rl-grip'), { x: 0, y: 20 });
      },
    },
  },
  {
    name: 'column-grip',
    family: 'handles',
    selector: '.rl-col-grip',
    pseudo: '::before',
    mayVanish: ['dragged'],
    reach: {
      rest: overCell('A | B'),
      hover: async (j) => {
        await overCell('A | B')(j);
        await pointAt(j, j.page.locator('.rl-col-grip'));
      },
      selected: async (j) => {
        await overCell('A | B')(j);
        await j.page.locator('.rl-col-grip').click();
        await overCell('A | B')(j);
      },
      dragged: async (j) => {
        await overCell('A | B')(j);
        await dragFrom(j, j.page.locator('.rl-col-grip'), { x: 40, y: 0 });
      },
    },
  },
  // ----- Cards: what floats over the page -----
  {
    name: 'comment-note',
    family: 'notes',
    selector: '.rl-note',
    views: ['redlines', 'simple'],
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator('.rl-note').first());
      },
    },
  },
  {
    name: 'notification',
    family: 'cards',
    selector: '.rl-notification',
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator('.rl-notification').first());
      },
    },
  },
  { name: 'eye-menu', family: 'cards', selector: '.rl-menu', reach: { rest: openEye } },
  {
    name: 'palette-menu',
    family: 'cards',
    selector: '.rl-toolbar-menu:not([hidden])',
    reach: { rest: openPalette },
  },
  { name: 'grip-menu', family: 'cards', selector: '.rl-grip-menu', reach: { rest: openGripMenu } },
  // ----- Rows of a menu: hover, and the item the keys chose -----
  {
    name: 'eye-menu-item',
    family: 'rows',
    frame: '.rl-menu',
    selector: '.rl-menu-item',
    selectorFor: {
      hover: '.rl-menu-item:hover',
      keys: '.rl-menu-item:focus-visible',
      selected: '.rl-menu-item[aria-checked="true"]',
    },
    reach: {
      rest: openEye,
      hover: async (j) => {
        await openEye(j);
        await hoverItem('.rl-menu-item')(j);
      },
      keys: eyeWithKeys,
      selected: openEye,
    },
  },
  {
    name: 'palette-item',
    family: 'rows',
    frame: '.rl-toolbar-menu:not([hidden])',
    selector: '.rl-toolbar-item',
    selectorFor: { hover: '.rl-toolbar-item:hover', keys: '.rl-toolbar-item:focus-visible' },
    reach: {
      rest: openPalette,
      hover: async (j) => {
        await openPalette(j);
        await hoverItem('.rl-toolbar-item')(j);
      },
      keys: async (j) => {
        await openPalette(j);
        await chooseWithKeys('.rl-toolbar-item')(j);
      },
    },
  },
  {
    name: 'grip-menu-item',
    family: 'rows',
    frame: '.rl-grip-menu',
    selector: '.rl-grip-item',
    selectorFor: { hover: '.rl-grip-item:hover' },
    // No `keys`: the grip's menu has no way to be chosen from with the keys (listed in the PR).
    reach: {
      rest: openGripMenu,
      hover: async (j) => {
        await openGripMenu(j);
        await hoverItem('.rl-grip-item')(j);
      },
    },
  },
  // ----- Buttons: the title bar's, and the notification's three -----
  {
    name: 'title-bar-button',
    family: 'buttons',
    selector: '.rl-titlebar-end .rl-icon-button',
    selectorFor: {
      hover: '.rl-titlebar-end .rl-icon-button:hover',
      keys: '.rl-titlebar-end .rl-icon-button:focus-visible',
    },
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator('.rl-titlebar-end .rl-icon-button').nth(0));
      },
      keys: async (j) => {
        await rest(j);
        await j.page.keyboard.press('Shift');
        await j.page.locator('.rl-titlebar-end .rl-icon-button').nth(0).focus();
      },
    },
  },
  ...(
    [
      ['notification-close', '.rl-notification-close'],
      ['notification-dismiss', '.rl-notification-dismiss'],
      ['notification-action', '.rl-notification-action'],
    ] as const
  ).map(([name, selector]): Specimen => ({
    name,
    family: 'buttons',
    selector,
    selectorFor: { hover: `${selector}:hover`, keys: `${selector}:focus-visible` },
    reach: {
      rest,
      hover: async (j) => {
        await rest(j);
        await pointAt(j, j.page.locator(selector).first());
      },
      keys: async (j) => {
        await rest(j);
        await j.page.keyboard.press('Shift');
        await j.page.locator(selector).first().focus();
      },
    },
  })),
  ...MORE,
];

/** What the page says of a specimen's style (and of its pseudo-element), in a state. */
export async function styleOf(
  page: Page,
  specimen: Specimen,
  state: State = 'rest',
): Promise<Style | null> {
  return page.evaluate(
    ([selector, pseudo, props]) => {
      // The first one that is drawn: a menu that is shut keeps its rows in the page.
      const el = [...document.querySelectorAll(selector as string)].find(
        (e) => e.getBoundingClientRect().width > 0,
      );
      if (!el) return null;
      const css = getComputedStyle(el, (pseudo as string) || null);
      return Object.fromEntries((props as string[]).map((p) => [p, (css as never)[p] as string]));
    },
    [
      specimen.selectorFor?.[state] ?? specimen.selector,
      specimen.pseudo ?? '',
      PROPS as readonly string[],
    ],
  ) as Promise<Style | null>;
}

// ----- Siblings agree -----

/** A rule that siblings must follow. */
export interface Family {
  name: string;
  /** What siblings share, in a sentence. */
  rule: string;
  /** The specimens' families it holds for. */
  of: readonly string[];
  /** `across`: every member agrees in the state; `within`: each member's two states agree. */
  how: { across: State } | { within: [State, State] };
  props: readonly Prop[];
}

export const FAMILIES: readonly Family[] = [
  {
    name: 'handles',
    rule: 'a handle is one pill of one fill, corner radius and outline, on a picture and on a table alike',
    of: ['handles'],
    how: { across: 'rest' },
    props: ['borderTopLeftRadius', 'backgroundColor', 'boxShadow'],
  },
  {
    name: 'card-radius',
    rule: 'a margin note sits in the margin and stays flat, and has the corner radius of what floats (#1246)',
    of: ['cards', 'notes'],
    how: { across: 'rest' },
    props: ['borderTopLeftRadius'],
  },
  {
    name: 'cards',
    rule: 'what floats over the page has one corner radius, one border and one shadow',
    of: ['cards'],
    how: { across: 'rest' },
    props: ['borderTopLeftRadius', 'borderTopColor', 'borderTopWidth', 'boxShadow'],
  },
  {
    name: 'hover',
    rule: 'a row or a button under the pointer takes one fill',
    of: ['rows', 'buttons'],
    how: { across: 'hover' },
    props: ['backgroundColor'],
  },
  {
    name: 'keys-like-hover',
    rule: 'an item the keys chose looks like one under the pointer (#1191)',
    of: ['rows', 'buttons'],
    how: { within: ['hover', 'keys'] },
    props: ['backgroundColor', 'outlineStyle'],
  },
  {
    name: 'focus-ring',
    rule: 'the focus ring is one outline',
    of: ['rows', 'buttons'],
    how: { across: 'keys' },
    props: ['outlineStyle', 'outlineWidth', 'outlineColor'],
  },
  {
    name: 'chips',
    rule: 'a chip in the text is one shape: one radius, one fill, one ink',
    of: ['chips'],
    how: { across: 'rest' },
    props: ['borderTopLeftRadius', 'backgroundColor', 'color', 'borderTopWidth'],
  },
  {
    name: 'chosen',
    rule: 'the chosen row (the checked view, the open file) has one fill',
    of: ['rows'],
    how: { across: 'selected' },
    props: ['backgroundColor'],
  },
];

export interface Disagreement {
  family: string;
  /** `<state>` or `<state>/<state>`. */
  state: string;
  prop: Prop;
  /** Who has which value. */
  detail: string;
}

/** Where siblings that should agree don't, in the styles read (keys are `<view>/<specimen>/<state>`). */
export function disagreements(
  styles: Record<string, Style | null>,
  view: string,
  specimens: readonly Specimen[] = SPECIMENS,
): Disagreement[] {
  const found: Disagreement[] = [];
  // An outline that isn't drawn has no width and no color that anyone sees.
  const at = (name: string, state: State): Style | undefined => {
    const style = styles[`${view}/${name}/${state}`];
    if (!style) return undefined;
    return style.outlineStyle === 'none'
      ? { ...style, outlineWidth: '0px', outlineColor: 'none' }
      : style;
  };
  for (const family of FAMILIES) {
    const members = specimens.filter((s) => family.of.includes(s.family));
    for (const prop of family.props) {
      if ('across' in family.how) {
        const state = family.how.across;
        const values = new Map<string, string[]>();
        for (const member of members) {
          const style = at(member.name, state);
          if (style) values.set(style[prop], [...(values.get(style[prop]) ?? []), member.name]);
        }
        if (values.size > 1) {
          found.push({
            family: family.name,
            state,
            prop,
            detail: [...values].map(([value, who]) => `${who.join(', ')}: ${value}`).join(' | '),
          });
        }
      } else {
        const [a, b] = family.how.within;
        const apart = members.flatMap((member) => {
          const x = at(member.name, a);
          const y = at(member.name, b);
          return x && y && x[prop] !== y[prop]
            ? [`${member.name}: ${a} ${x[prop]}, ${b} ${y[prop]}`]
            : [];
        });
        if (apart.length > 0) {
          found.push({ family: family.name, state: `${a}/${b}`, prop, detail: apart.join(' | ') });
        }
      }
    }
  }
  return found;
}

/** A disagreement that an open issue is about. */
export interface KnownDisagreement {
  issue: number;
  family: string;
  /** The properties of the family that differ today. */
  props: readonly Prop[];
  why: string;
}

/**
 * The disagreements that stand today, each with the issue that owns it. The check passes with them,
 * fails on one that isn't listed (a new one, or a fixed one that came back) and on a listed one
 * that no longer differs: the PR that fixes the issue deletes its entry, and nothing else.
 */
export const KNOWN: readonly KnownDisagreement[] = [
  {
    issue: 1199,
    family: 'handles',
    props: ['borderTopLeftRadius', 'backgroundColor', 'boxShadow'],
    why: 'the picture’s handles are white pills with an outline; the table’s grips are gray pills with a border and a bigger radius',
  },
  {
    issue: 1172,
    family: 'chips',
    props: ['color'],
    why: 'a reference chip is in the full ink, a citation chip in the gray one (both are heavy chips; #1172 makes them text with a dotted underline)',
  },
];

/** What the check reports: disagreements nobody knows, and known ones that are gone. */
export function judgeDisagreements(
  found: readonly Disagreement[],
  known: readonly KnownDisagreement[] = KNOWN,
): { unknown: string[]; gone: string[] } {
  const isKnown = (d: Disagreement) =>
    known.some((k) => k.family === d.family && k.props.includes(d.prop));
  const unknown = found
    .filter((d) => !isKnown(d))
    .map((d) => `${d.family} (${d.state}) ${d.prop}: ${d.detail}`);
  const gone: string[] = [];
  for (const k of known) {
    for (const prop of k.props) {
      if (!found.some((d) => d.family === k.family && d.prop === prop)) {
        gone.push(
          `#${k.issue}: ${k.family} ${prop} agrees now: delete it from KNOWN in sheet.ts (${k.why})`,
        );
      }
    }
  }
  return { unknown, gone };
}
