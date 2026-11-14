import { describe, expect, it } from 'vitest';
import { areasFor, grepFor } from './areas.ts';

describe('the journeys a pull request runs', () => {
  it('runs the smoke journeys alone for a path no journey is about', () => {
    expect(grepFor(['apps/desktop/src-tauri/src/lib.rs', 'packages/cli/src/main.ts'])).toBe(
      '@smoke',
    );
    expect(grepFor([])).toBe('@smoke');
  });

  it('adds the areas of the paths', () => {
    expect(grepFor(['plugins/tables/src/grips.ts'])).toBe('@smoke|@tables');
    expect(grepFor(['packages/editor/src/blocks/keys.ts'])).toBe('@smoke|@lists|@blocks');
    expect(grepFor(['plugins/review/src/bar.ts', 'plugins/tables/src/plus.ts'])).toBe(
      '@smoke|@tables|@links|@views',
    );
  });

  it('runs every journey for a path that every journey draws through', () => {
    for (const path of [
      'packages/format/src/ids.ts',
      'packages/editor/src/index.ts',
      'packages/editor/src/tracked/typing.ts',
      'plugins/themes/src/tokens.css',
      'apps/desktop/src/main.ts',
      'apps/desktop/journeys/src/journey.ts',
      'pnpm-lock.yaml',
      '.github/workflows/journeys.yml',
    ]) {
      expect(areasFor([path]), path).toBe('all');
      expect(grepFor(['plugins/tables/src/grips.ts', path])).toBe('');
    }
  });
});
