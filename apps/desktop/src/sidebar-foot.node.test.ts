// The sidebar's foot shows the person's name (#1194), which Preferences can change while the window
// is open: the window's settings listener must draw the foot again when the name changes. main.ts
// can't be run in a test, so this holds the wiring where it is written.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8');

describe('the sidebar’s foot', () => {
  it('is drawn again when Preferences change the name', () => {
    const listener = main.slice(main.indexOf('watchSettings((changed) => {'));
    const changed = listener.slice(
      listener.indexOf('if (next.handle !== author.handle || next.name !== author.name) {'),
    );
    const block = changed.slice(0, changed.indexOf('\n  }\n') + 4);
    expect(block).toContain('setAuthor(next);');
    expect(block).toContain('sidebar.refreshFoot();');
  });

  it('reads the name from the author the window keeps, not a copy', () => {
    expect(main).toMatch(/foot: \{\s*name: \(\) => author\.name/);
  });
});
