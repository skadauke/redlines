import { describe, expect, it } from 'vitest';
import { PLAIN_ONLY_EXTENSIONS as CLI_PLAIN_ONLY } from '../../../packages/cli/src/plain-only.ts';
import { PLAIN_ONLY_EXTENSIONS } from './file-names.ts';

describe('the table of Plain-only extensions', () => {
  it('is the command line’s, which refuses to mark such a file', () => {
    expect([...CLI_PLAIN_ONLY].sort()).toEqual(Object.values(PLAIN_ONLY_EXTENSIONS).flat().sort());
  });
});
