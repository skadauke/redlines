// The icon in About Redlines goes through the icon family when it is clicked: the next mark takes
// the place of the one shown, drawn as a tracked change. The mark shown is struck through with a
// red line that is drawn across it, and fades out; the next mark comes in from below, with a red
// underline that is drawn across under it and goes, all in about half a second. A person who has
// asked for less motion gets a plain crossfade. Nothing announces it: the cursor stays an arrow, and
// the icon has no label (about.css). The app's Dock icon follows the mark, until the next launch.

/**
 * The marks of the family, as the names of their files in `src-tauri/icons/family`, in the order
 * the launches show them (`MARKS` in src-tauri/src/dock_icon.rs, which a test keeps in step with
 * this). The first is the caret, the icon the app is installed with.
 */
export const MARKS = [
  'caret',
  'change-bar',
  'margin-bracket',
  'delete-mark',
  'redline',
  'caret-insertion',
] as const;

export type Mark = (typeof MARKS)[number];

/** The mark after `mark`, and the caret after the last. */
export function nextMark(mark: Mark): Mark {
  return MARKS[(MARKS.indexOf(mark) + 1) % MARKS.length] ?? 'caret';
}

/** The mark named `name`, or the caret for a name that is no mark. */
export function markOrCaret(name: string): Mark {
  return MARKS.find((mark) => mark === name) ?? 'caret';
}

/** What a running animation lets its owner do: wait for its end, and cut it short. */
export interface Animation {
  finished: Promise<unknown>;
  cancel(): void;
}

/** Runs an animation of an element: the Web Animations API's, or a stand-in in tests. */
export type Animator = (
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => Animation;

/** The page's own animations, held at their last frame until they are cancelled. */
const webAnimate: Animator = (element, keyframes, options) => {
  const animation = element.animate(keyframes, { fill: 'both', ...options });
  // Cancelling one is how it is cut short, and it rejects its promise when it is.
  return { finished: animation.finished.catch(() => undefined), cancel: () => animation.cancel() };
};

export interface IconCycler {
  /** The mark the icon shows, or is changing to. */
  current(): Mark;
  /** Changes to the next mark, finishing a change that is going first. */
  click(): void;
}

export interface CyclerOptions {
  /** The file of each mark. */
  urls: Record<Mark, string>;
  /** The mark the icon starts on: the one the app's icon shows. */
  start: Mark;
  /** Whether the person has asked for less motion, read at each click. */
  reducedMotion(): boolean;
  /** Tells the app the mark the icon changes to, so that its Dock icon follows. */
  show(mark: Mark): void;
  /** How things are animated; the page's own by default, and none where it has none. */
  animate?: Animator;
}

/** The milliseconds of each part of the change: it ends about half a second after the click. */
const STRIKE = { duration: 140 };
const FADE_OUT = { duration: 200, delay: 100 };
const COME_IN = { duration: 240, delay: 170 };
const UNDERLINE = { duration: 200, delay: 210 };
const UNDERLINE_GOES = { duration: 110, delay: 410 };
const CROSSFADE = { duration: 180 };

/** How far below its place the next mark starts, in CSS pixels. */
const RISE_PX = 16;

/** Draws the mark `options.start` in `stage`, and changes it on each `click()`. */
export function createIconCycler(stage: HTMLElement, options: CyclerOptions): IconCycler {
  const animate: Animator | null =
    options.animate ?? (typeof stage.animate === 'function' ? webAnimate : null);

  const draw = (mark: Mark): HTMLImageElement => {
    const img = document.createElement('img');
    img.className = 'rl-mark';
    img.dataset['mark'] = mark;
    img.src = options.urls[mark];
    // The icon is the window's picture, not information: it has no name to read out.
    img.alt = '';
    img.draggable = false;
    stage.append(img);
    return img;
  };
  const line = (className: string): HTMLElement => {
    const element = document.createElement('div');
    element.className = className;
    stage.append(element);
    return element;
  };

  let mark = options.start;
  let shown = draw(mark);
  /** The change that is going, which finishes it when called. */
  let going: (() => void) | null = null;

  const click = () => {
    going?.();
    const from = shown;
    mark = nextMark(mark);
    options.show(mark);
    if (!animate) {
      from.remove();
      shown = draw(mark);
      return;
    }
    const incoming = draw(mark);
    shown = incoming;
    const animations: Animation[] = [];
    const lines: HTMLElement[] = [];
    if (options.reducedMotion()) {
      animations.push(
        animate(from, [{ opacity: 1 }, { opacity: 0 }], { ...CROSSFADE, easing: 'linear' }),
        animate(incoming, [{ opacity: 0 }, { opacity: 1 }], { ...CROSSFADE, easing: 'linear' }),
      );
    } else {
      const strike = line('rl-strike');
      const underline = line('rl-underline');
      lines.push(strike, underline);
      animations.push(
        animate(strike, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          ...STRIKE,
          easing: 'ease-out',
        }),
        animate(from, [{ opacity: 1 }, { opacity: 0 }], { ...FADE_OUT, easing: 'ease-in' }),
        animate(
          incoming,
          [
            { opacity: 0, transform: `translateY(${RISE_PX}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { ...COME_IN, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        ),
        animate(
          underline,
          [
            { transform: 'scaleX(0)', opacity: 1 },
            { transform: 'scaleX(1)', opacity: 1 },
          ],
          { ...UNDERLINE, easing: 'ease-out' },
        ),
        animate(underline, [{ opacity: 1 }, { opacity: 0 }], {
          ...UNDERLINE_GOES,
          easing: 'linear',
        }),
      );
    }
    const finish = () => {
      if (going !== finish) return;
      going = null;
      for (const animation of animations) animation.cancel();
      from.remove();
      for (const element of lines) element.remove();
    };
    going = finish;
    void Promise.all(animations.map((animation) => animation.finished)).then(finish);
  };

  return { current: () => mark, click };
}
