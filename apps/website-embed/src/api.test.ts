import type { ViewMode } from '@redlines/editor';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DemoView } from './api.ts';
import { VIEWS } from './views.ts';

describe('the page-facing API', () => {
  it('has the editor’s views, no more and no fewer', () => {
    expectTypeOf<DemoView>().toEqualTypeOf<ViewMode>();
  });

  it('lists the views in order with the words of the app’s View menu', () => {
    expect(VIEWS).toEqual([
      { view: 'clean', label: 'Clean' },
      { view: 'simple', label: 'Simple' },
      { view: 'redlines', label: 'Redlines' },
      { view: 'raw', label: 'Raw' },
    ]);
  });
});
