// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIconCycler,
  markOrCaret,
  MARKS,
  nextMark,
  type Animator,
  type Mark,
} from './marks.ts';

const URLS = Object.fromEntries(MARKS.map((mark) => [mark, `/${mark}.png`])) as Record<
  Mark,
  string
>;

/** An animation a test finishes when it says so. */
interface Running {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  finished: Promise<unknown>;
  finish(): void;
  cancel: ReturnType<typeof vi.fn>;
}

function setup(start: Mark = 'caret', reduced = false) {
  const stage = document.createElement('div');
  document.body.append(stage);
  const running: Running[] = [];
  const animate: Animator = (element, keyframes, options) => {
    let finish = () => {};
    const finished = new Promise<unknown>((resolve) => (finish = () => resolve(undefined)));
    // As the page's own animation does, which settles its `finished` when it is cancelled too: the
    // cycler hears of an end it caused itself.
    const cancel = vi.fn(() => finish());
    const animation = { element, keyframes, options, finished, finish, cancel };
    running.push(animation);
    return animation;
  };
  const shown: Mark[] = [];
  const motion = { reduced };
  const cycler = createIconCycler(stage, {
    urls: URLS,
    start,
    reducedMotion: () => motion.reduced,
    show: (mark) => shown.push(mark),
    animate,
  });
  const settle = async () => {
    for (const animation of running.splice(0)) animation.finish();
    // The cycler's own promises, which a finished animation lets go on.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const marks = () =>
    [...stage.querySelectorAll<HTMLImageElement>('img')].map((img) => img.dataset['mark']);
  return { stage, running, shown, cycler, settle, marks, motion };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the family of marks', () => {
  it('goes round in the order the launches show them, and starts over after the last', () => {
    expect(MARKS).toEqual([
      'caret',
      'change-bar',
      'margin-bracket',
      'delete-mark',
      'redline',
      'caret-insertion',
    ]);
    expect(nextMark('caret')).toBe('change-bar');
    expect(nextMark('redline')).toBe('caret-insertion');
    expect(nextMark('caret-insertion')).toBe('caret');
  });

  it('takes the caret for a name that is no mark', () => {
    expect(markOrCaret('delete-mark')).toBe('delete-mark');
    for (const name of ['', 'Caret', 'caret.png', 'icon', '../caret']) {
      expect(markOrCaret(name)).toBe('caret');
    }
  });
});

describe('the icon cycler', () => {
  it('shows the mark it starts with, drawn and still', () => {
    const { stage, running, marks, cycler } = setup('delete-mark');
    expect(marks()).toEqual(['delete-mark']);
    expect(stage.querySelector('img')?.getAttribute('src')).toBe('/delete-mark.png');
    expect(stage.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(running).toEqual([]);
    expect(cycler.current()).toBe('delete-mark');
  });

  it('changes the mark: the old fades, the new comes in from below, and no red line is drawn', async () => {
    const { stage, running, marks, shown, cycler, settle } = setup('caret');
    cycler.click();
    // At once: the app is told, so that the Dock follows; both marks are there.
    expect(shown).toEqual(['change-bar']);
    expect(marks()).toEqual(['caret', 'change-bar']);
    expect([...stage.children].every((child) => child.tagName === 'IMG')).toBe(true);
    const byElement = (selector: string) =>
      running.filter(({ element }) => element.matches(selector));
    const old = byElement("img[data-mark='caret']");
    expect(old[0]?.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    const incoming = byElement("img[data-mark='change-bar']");
    expect(incoming[0]?.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(String(incoming[0]?.keyframes[0]?.['transform'])).toMatch(/^translateY\([1-9]/);
    expect(incoming[0]?.keyframes.at(-1)).toMatchObject({ opacity: 1, transform: 'translateY(0)' });
    // Only the two marks are animated.
    expect(running.every(({ element }) => element.tagName === 'IMG')).toBe(true);
    await settle();
    expect(marks()).toEqual(['change-bar']);
    expect(stage.children).toHaveLength(1);
    expect(cycler.current()).toBe('change-bar');
  });

  it('takes about half a second', () => {
    const { running, cycler } = setup();
    cycler.click();
    const ends = running.map(
      ({ options }) => Number(options.delay ?? 0) + Number(options.duration ?? 0),
    );
    expect(Math.max(...ends)).toBeGreaterThanOrEqual(450);
    expect(Math.max(...ends)).toBeLessThanOrEqual(650);
  });

  it('goes on through the whole family and round again', async () => {
    const { shown, cycler, settle, marks } = setup('redline');
    for (let i = 0; i < 3; i++) {
      cycler.click();
      await settle();
    }
    expect(shown).toEqual(['caret-insertion', 'caret', 'change-bar']);
    expect(marks()).toEqual(['change-bar']);
  });

  it('is a plain crossfade for a person who has asked for less motion', async () => {
    const { stage, running, marks, shown, cycler, settle } = setup('caret', true);
    cycler.click();
    expect(shown).toEqual(['change-bar']);
    expect(marks()).toEqual(['caret', 'change-bar']);
    expect(stage.querySelector('div')).toBeNull();
    expect(running.length).toBeGreaterThan(0);
    for (const { keyframes, options } of running) {
      // Opacity only: nothing moves or is drawn across.
      for (const frame of keyframes) expect(Object.keys(frame)).toEqual(['opacity']);
      expect(Number(options.delay ?? 0) + Number(options.duration ?? 0)).toBeLessThanOrEqual(300);
    }
    await settle();
    expect(marks()).toEqual(['change-bar']);
  });

  it('finishes a change that is going when the icon is clicked again, and goes on from there', async () => {
    const { running, marks, shown, cycler, settle } = setup('caret');
    cycler.click();
    const first = [...running];
    // Not finished yet: another click.
    cycler.click();
    expect(first.every(({ cancel }) => cancel.mock.calls.length === 1)).toBe(true);
    expect(shown).toEqual(['change-bar', 'margin-bracket']);
    // The first change is settled, and the second is under way from it.
    expect(marks()).toEqual(['change-bar', 'margin-bracket']);
    await settle();
    expect(marks()).toEqual(['margin-bracket']);
    expect(cycler.current()).toBe('margin-bracket');
  });

  it('does not let a change that was cut short end the one that follows', async () => {
    const { marks, cycler } = setup('caret');
    cycler.click();
    // The second click cuts the first short, which settles its animations, a moment after.
    cycler.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // The third finds the second still going, and finishes it: nothing of it is left behind.
    cycler.click();
    expect(marks()).toEqual(['margin-bracket', 'delete-mark']);
  });

  it('reads whether the person wants less motion at each click', async () => {
    const { stage, motion, cycler, settle, marks } = setup('caret');
    cycler.click();
    await settle();
    motion.reduced = true;
    cycler.click();
    expect(stage.querySelector('div')).toBeNull();
    await settle();
    motion.reduced = false;
    cycler.click();
    await settle();
    expect(marks()).toEqual(['delete-mark']);
  });

  it('shows no change when the animations cannot run, and still ends on the next mark', () => {
    const stage = document.createElement('div');
    document.body.append(stage);
    // A page without the Web Animations API.
    Object.defineProperty(stage, 'animate', { value: undefined });
    const shown: Mark[] = [];
    const cycler = createIconCycler(stage, {
      urls: URLS,
      start: 'caret',
      reducedMotion: () => false,
      show: (mark) => shown.push(mark),
    });
    cycler.click();
    expect(cycler.current()).toBe('change-bar');
    expect([...stage.querySelectorAll('img')].map((img) => img.dataset['mark'])).toEqual([
      'change-bar',
    ]);
    expect(shown).toEqual(['change-bar']);
  });
});

describe('the page’s own animations', () => {
  /** What `Element.animate` is called with, and an animation that is over at once, as one is that
   * has been cancelled: the browser rejects its `finished` then. */
  function pageAnimations(over: () => Promise<unknown>) {
    const calls: { element: Element; options: KeyframeAnimationOptions }[] = [];
    const cancel = vi.fn();
    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (
      this: Element,
      _keyframes,
      options,
    ) {
      calls.push({ element: this, options: options as KeyframeAnimationOptions });
      return { finished: over(), cancel } as unknown as Animation;
    });
    return { calls, cancel };
  }

  function stageWith(urls = URLS) {
    const stage = document.createElement('div');
    document.body.append(stage);
    const cycler = createIconCycler(stage, {
      urls,
      start: 'caret',
      reducedMotion: () => false,
      show: () => {},
    });
    return { stage, cycler };
  }

  it('holds each at its last frame until the change is over, so that nothing jumps back', () => {
    const { calls } = pageAnimations(() => new Promise(() => {}));
    const { cycler } = stageWith();
    cycler.click();
    expect(calls.length).toBeGreaterThan(0);
    for (const { options } of calls) expect(options.fill).toBe('both');
  });

  it('ends the change when an animation is cut short, which the browser reports as a refusal', async () => {
    pageAnimations(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    const { stage, cycler } = stageWith();
    cycler.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect([...stage.querySelectorAll('img')].map((img) => img.dataset['mark'])).toEqual([
      'change-bar',
    ]);
    expect(stage.querySelector('div')).toBeNull();
  });

  it('ends the change when its animations run out', async () => {
    const { cancel } = pageAnimations(() => Promise.resolve());
    const { stage, cycler } = stageWith();
    cycler.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect([...stage.querySelectorAll('img')].map((img) => img.dataset['mark'])).toEqual([
      'change-bar',
    ]);
    // What ran out is let go of, not left holding its last frame on the elements.
    expect(cancel).toHaveBeenCalled();
  });
});
