// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountEmbed } from './entry.ts';

const docWithMarks = [
  'We <!--ins k3x9-->now <!--/k3x9-->ship <!--hl h1h1-->it<!--/h1h1-->.',
  '',
  '<!-- redlines',
  'version: 1',
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
  '  h1h1: {by: ada, at: 2026-10-31T09:31Z}',
  '-->',
  '',
].join('\n');

describe('mountEmbed', () => {
  it('mounts the core and review with a stub host and shows a document with marks', () => {
    const parent = document.createElement('div');
    document.body.append(parent);

    const editor = mountEmbed(parent, docWithMarks);

    expect(editor.getUiState().hasRedlines).toBe(true);
    expect(editor.getDoc()).toBe(docWithMarks);
    expect(parent.querySelector('.cm-content')).not.toBeNull();
    editor.destroy();
  });
});
