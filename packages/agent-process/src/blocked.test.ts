import type { AgentRequest } from '@redlines/plugin-api';
import { describe, expect, it } from 'vitest';
import { blockedRead, blockedStatus, insideReach, protectedFolder } from './blocked.ts';

const base = {
  thread: 'c1',
  prompt: '',
  systemPrompt: '',
  author: { handle: 'a', name: 'A', for: 'b' },
};
const folder: AgentRequest = {
  ...base,
  scope: 'folder',
  folder: '/Users/ada/code/redlines',
  documentPath: '/Users/ada/code/redlines/docs/plan.md',
};
const home: AgentRequest = {
  ...folder,
  scope: 'everything',
  homeRoots: ['/Users/ada/Documents', '/Users/ada/code', '/Users/ada/Library/CloudStorage'],
};
const document: AgentRequest = {
  ...base,
  scope: 'document',
  documentPath: '/Users/ada/code/redlines/docs/plan.md',
};

describe('insideReach', () => {
  it('is the folder at This folder, and what is under it', () => {
    expect(insideReach('/Users/ada/code/redlines', folder)).toBe(true);
    expect(insideReach('/Users/ada/code/redlines/docs/a.md', folder)).toBe(true);
    // A folder whose name starts the same, a sibling, and a climb out are not inside.
    expect(insideReach('/Users/ada/code/redlines-secrets/a.md', folder)).toBe(false);
    expect(insideReach('/Users/ada/code/other/a.md', folder)).toBe(false);
    expect(insideReach('/Users/ada/code/redlines/../other/a.md', folder)).toBe(false);
    expect(insideReach('/Users/ada/Documents/a.md', folder)).toBe(false);
    expect(insideReach('relative/a.md', folder)).toBe(false);
  });

  it('is the document alone at This document', () => {
    expect(insideReach('/Users/ada/code/redlines/docs/plan.md', document)).toBe(true);
    expect(insideReach('/Users/ada/code/redlines/docs/other.md', document)).toBe(false);
    expect(insideReach('/Users/ada/code/redlines', document)).toBe(false);
  });

  it('adds the home folders at This folder and my home folder', () => {
    expect(insideReach('/Users/ada/Documents/ref/spec.md', home)).toBe(true);
    expect(insideReach('/Users/ada/Library/CloudStorage/Dropbox/a.md', home)).toBe(true);
    expect(insideReach('/Users/ada/code/redlines/a.md', home)).toBe(true);
    // Not what the guardrails leave out.
    expect(insideReach('/Users/ada/.ssh/id_rsa', home)).toBe(false);
    expect(insideReach('/Users/ada/Library/Mail/x', home)).toBe(false);
    expect(insideReach('/etc/hosts', home)).toBe(false);
  });
});

describe('protectedFolder', () => {
  it('names the folders macOS asks about, and none other', () => {
    expect(protectedFolder('/Users/ada/Documents/a.md')).toBe('Documents');
    expect(protectedFolder('/Users/ada/Documents')).toBe('Documents');
    expect(protectedFolder('/Users/ada/Desktop/a.md')).toBe('Desktop');
    expect(protectedFolder('/Users/ada/Downloads/a.zip')).toBe('Downloads');
    expect(protectedFolder('/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/a.md')).toBe(
      'iCloud Drive',
    );
    expect(protectedFolder('/Users/ada/Library/CloudStorage/Dropbox/a.md')).toBe('Dropbox');
    expect(
      protectedFolder('/Users/ada/Library/CloudStorage/GoogleDrive-ada@example.org/My Drive/a.md'),
    ).toBe('GoogleDrive-ada@example.org');
    expect(protectedFolder('/Volumes/Backup/notes/a.md')).toBe('Backup');
    expect(protectedFolder('/Users/ada/code/redlines/a.md')).toBeUndefined();
    expect(protectedFolder('/Users/ada/DocumentsOld/a.md')).toBeUndefined();
    expect(protectedFolder('/tmp/a.md')).toBeUndefined();
  });
});

describe('blockedRead', () => {
  it('says macOS privacy for a refused read in a folder it asks about', () => {
    expect(
      blockedRead(
        '/Users/ada/Documents/plan.md',
        "EPERM: operation not permitted, open '/Users/ada/Documents/plan.md'",
        home,
      ),
    ).toEqual({ path: '/Users/ada/Documents/plan.md', cause: 'privacy', place: 'Documents' });
    expect(
      blockedRead('/Users/ada/Documents/plan.md', 'cat: x: Operation not permitted', home),
    ).toEqual({
      path: '/Users/ada/Documents/plan.md',
      cause: 'privacy',
      place: 'Documents',
    });
  });

  it('says the file’s permissions for a permission denied', () => {
    expect(
      blockedRead(
        '/Users/ada/code/redlines/secret.md',
        'EACCES: permission denied, open x',
        folder,
      ),
    ).toEqual({ path: '/Users/ada/code/redlines/secret.md', cause: 'permission' });
    expect(
      blockedRead('/Users/ada/code/redlines/a.md', 'cat: a.md: Permission denied', folder)?.cause,
    ).toBe('permission');
  });

  it('says the agent’s settings for what its own rules refused, inside what it may read', () => {
    const words =
      "Permission to use Read has been denied because Claude Code is running in don't ask mode.";
    expect(blockedRead('/Users/ada/code/redlines/notes.md', words, folder)).toEqual({
      path: '/Users/ada/code/redlines/notes.md',
      cause: 'settings',
    });
  });

  it('gives the agent’s own words, on one line, for any other cause', () => {
    expect(
      blockedRead('/Users/ada/code/redlines/a.md', 'EIO: i/o error,\nread   timed out', folder),
    ).toEqual({
      path: '/Users/ada/code/redlines/a.md',
      cause: 'other',
      words: 'EIO: i/o error, read timed out',
    });
    // Operation not permitted outside a folder macOS asks about isn't privacy.
    expect(
      blockedRead('/Users/ada/code/redlines/a.md', 'Operation not permitted', folder)?.cause,
    ).toBe('other');
  });

  it('says nothing for a read outside what the agent may read: that is a limit doing its work', () => {
    expect(
      blockedRead('/Users/ada/.ssh/id_rsa', 'EPERM: operation not permitted', home),
    ).toBeUndefined();
    expect(
      blockedRead('/Users/ada/Documents/a.md', 'EPERM: operation not permitted', folder),
    ).toBeUndefined();
    expect(blockedRead('/etc/hosts', 'Permission denied', document)).toBeUndefined();
  });

  it('says nothing for a hidden file at the home folder scope, which is left out on purpose', () => {
    expect(
      blockedRead('/Users/ada/code/app/.env', 'Permission to use Read has been denied', home),
    ).toBeUndefined();
    expect(
      blockedRead('/Users/ada/code/app/.git/config', 'Operation not permitted', home),
    ).toBeUndefined();
    // At This folder nothing is left out, so a refusal there is news.
    expect(
      blockedRead('/Users/ada/code/redlines/.env', 'EACCES: permission denied', folder)?.cause,
    ).toBe('permission');
  });

  it('keeps the words short', () => {
    const long = blockedRead('/Users/ada/code/redlines/a.md', `weird ${'x '.repeat(300)}`, folder);
    expect(long?.cause).toBe('other');
    expect(long?.words?.length).toBeLessThanOrEqual(200);
  });
});

describe('blockedStatus', () => {
  it('names the file, in a line the live line can hold', () => {
    expect(blockedStatus({ path: '/Users/ada/Documents/plan.md', cause: 'privacy' })).toBe(
      'Couldn’t read plan.md',
    );
    const long = blockedStatus({ path: `/a/${'very-long-name-'.repeat(5)}.md`, cause: 'other' });
    expect(Array.from(long).length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});
