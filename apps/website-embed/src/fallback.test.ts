// @vitest-environment happy-dom
import { reviewView } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import demoText from '../../../website/lib/demo-text.json';
import type { DemoText, Segment } from '../../../website/lib/demo-text.ts';
import { DOCS } from './docs.ts';
import { advance, mountForTest, post } from './test-helpers.ts';

/** A segment as `reviewView` writes it, without ids. */
function segment(each: Segment): string {
  switch (each.t) {
    case 'text':
      return each.s;
    case 'ins':
      return `{++${each.s}++}[${each.by}]`;
    case 'del':
      return `{--${each.s}--}[${each.by}]`;
    case 'sub':
      return `{~~${each.old}~>${each.s}~~}[${each.by}]`;
    case 'cmt':
      return `{==${each.children.map(segment).join('')}==}${each.thread
        .map(({ by, text }) => `{>>[${by}] ${text}<<}`)
        .join('')}`;
  }
}

/** What the fallback's data says, in the words of `reviewView`. */
export const toReview = (text: DemoText): string =>
  `# ${text.title}\n\n${text.segments.map(segment).join('')}\n`;

/** `reviewView` names each mark by id too; the fallback's data holds no ids. */
const strip = (review: string) => review.replace(/\[[a-z0-9]{4} /g, '[');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the fallback', () => {
  it('draws what plan.md says (if not, update website/lib/demo-text.json)', () => {
    expect(toReview(demoText.plan as DemoText), 'website/lib/demo-text.json').toBe(
      strip(reviewView(DOCS.plan.text)),
    );
  });

  it('draws what the scripted run leaves (if not, update website/lib/demo-text.json)', async () => {
    const { handle, root } = mountForTest('design');
    handle.askClaude();
    post(root);
    await advance(3000);
    expect(toReview(demoText.design as DemoText), 'website/lib/demo-text.json').toBe(
      strip(reviewView(handle.getDoc())),
    );
  });
});
