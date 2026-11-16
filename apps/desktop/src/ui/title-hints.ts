// Hover hints for every `title` in a window. The system draws a title as a black bubble, which is
// not the app's look (#684), so while the pointer rests on an element that has one, the title is
// put away (the system then has nothing to draw) and the app's own hint is shown instead, in the
// notifications' grays (title-hints.css). The title is given back when the pointer leaves, so
// that it stays the element's description for assistive technology and for the code that set it.
// Nothing else changes: the elements keep setting `title`.

/** The pause before a hint shows, as the icons' own hints have it. */
export const TITLE_HINT_MS = 400;

export interface TitleHints {
  /** Puts the hint away and gives the title back. */
  hide(): void;
  destroy(): void;
}

export function installTitleHints(doc: Document = document, delay = TITLE_HINT_MS): TitleHints {
  const win = doc.defaultView ?? window;
  let tip: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let held = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The element's title is back, unless the code that owns it has set another meanwhile. */
  function release(): void {
    if (target && held && !target.hasAttribute('title')) target.setAttribute('title', held);
    target = null;
    held = '';
  }

  function hide(): void {
    clearTimeout(timer);
    release();
    tip?.remove();
    tip = null;
  }

  function show(el: HTMLElement, text: string): void {
    tip?.remove();
    const made = doc.createElement('div');
    made.className = 'rl-title-hint';
    made.setAttribute('role', 'presentation');
    made.textContent = text;
    doc.body.append(made);
    tip = made;
    const at = el.getBoundingClientRect();
    const size = made.getBoundingClientRect();
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const height = doc.documentElement.clientHeight || win.innerHeight;
    const centered = at.left + at.width / 2 - size.width / 2;
    const below = at.bottom + 6;
    made.style.left = `${Math.max(8, Math.min(centered, width - size.width - 8))}px`;
    made.style.top = `${below + size.height + 8 > height ? Math.max(8, at.top - size.height - 6) : below}px`;
  }

  const onOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const el = event.target.closest<HTMLElement>('[title]');
    if (el === target) return;
    hide();
    const text = el?.getAttribute('title')?.trim();
    if (!el || !text) return;
    target = el;
    held = el.getAttribute('title') ?? '';
    el.removeAttribute('title');
    timer = setTimeout(() => show(el, text), delay);
  };
  const onOut = (event: PointerEvent) => {
    if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) {
      hide();
    }
  };
  const onAway = () => hide();
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hide();
  };

  doc.addEventListener('pointerover', onOver, true);
  doc.addEventListener('pointerout', onOut, true);
  doc.addEventListener('pointerdown', onAway, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('scroll', onAway, true);
  win.addEventListener('blur', onAway);

  return {
    hide,
    destroy() {
      hide();
      doc.removeEventListener('pointerover', onOver, true);
      doc.removeEventListener('pointerout', onOut, true);
      doc.removeEventListener('pointerdown', onAway, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('scroll', onAway, true);
      win.removeEventListener('blur', onAway);
    },
  };
}
