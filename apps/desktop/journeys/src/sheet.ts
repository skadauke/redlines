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
    family: 'cards',
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
    selectorFor: { hover: '.rl-grip-item:hover', keys: '.rl-grip-item:focus-visible' },
    reach: {
      rest: openGripMenu,
      hover: async (j) => {
        await openGripMenu(j);
        await hoverItem('.rl-grip-item')(j);
      },
      keys: async (j) => {
        await openGripMenu(j);
        await chooseWithKeys('.rl-grip-item')(j);
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
        await pointAt(j, j.page.locator('.rl-titlebar-end .rl-icon-button').nth(1));
      },
      keys: async (j) => {
        await rest(j);
        await j.page.keyboard.press('Shift');
        await j.page.locator('.rl-titlebar-end .rl-icon-button').nth(1).focus();
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
    issue: 1246,
    family: 'cards',
    props: ['borderTopLeftRadius', 'boxShadow'],
    why: 'a margin note has an 8 px radius and no shadow, the palette’s menu 10 px, a notification and the other menus 12 px',
  },
  {
    issue: 1247,
    family: 'hover',
    props: ['backgroundColor'],
    why: 'rows take 55% of the pressed gray, buttons the full gray, the action the rule gray, and the title bar’s buttons none',
  },
  {
    issue: 1191,
    family: 'keys-like-hover',
    props: ['backgroundColor'],
    why: 'a key-chosen menu row is the full pressed gray, unlike its hover (the palette; the same shape in the other rows)',
  },
  {
    issue: 1247,
    family: 'keys-like-hover',
    props: ['outlineStyle'],
    why: 'buttons show a ring when chosen with the keys and no fill, unlike their hover',
  },
  {
    issue: 1247,
    family: 'focus-ring',
    props: ['outlineStyle', 'outlineWidth', 'outlineColor'],
    why: 'rows show a fill and no ring when chosen with the keys, buttons a 2 px ring',
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
