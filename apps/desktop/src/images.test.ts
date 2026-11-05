import { describe, expect, it } from 'vitest';
import { localImageUrl } from './images.ts';

const url = (path: string) => `asset://${path}`;
const at = (src: string, document = '/repo/docs/plan.md', project = '/repo') =>
  localImageUrl(src, document, project, url);

describe('localImageUrl', () => {
  it('resolves a path relative to the document', () => {
    expect(at('cat.png')).toBe('asset:///repo/docs/cat.png');
    expect(at('./img/cat.png')).toBe('asset:///repo/docs/img/cat.png');
    expect(at('../logo.png')).toBe('asset:///repo/logo.png');
  });

  it('resolves an absolute path inside the project', () => {
    expect(at('/repo/shots/a.png')).toBe('asset:///repo/shots/a.png');
  });

  it('leaves out a file outside the project', () => {
    expect(at('../../secret.png')).toBeNull();
    expect(at('/etc/hosts')).toBeNull();
    expect(at('../../../../../x.png')).toBeNull();
    // A folder that only starts with the project's name.
    expect(at('/repository/a.png')).toBeNull();
    expect(at('../a.png', '/repo/docs/plan.md', '/repo/docs')).toBeNull();
  });

  it('does not let a .. climb out and back in', () => {
    expect(at('../../repo/docs/../a.png')).toBe('asset:///repo/a.png');
    expect(at('a/../../../x.png')).toBeNull();
  });

  it('reads Windows paths', () => {
    expect(localImageUrl('img\\a.png', 'C:\\work\\doc.md', 'C:\\work', (p) => p)).toBe(
      'C:\\work\\img\\a.png',
    );
  });
});
