// @vitest-environment happy-dom
import { createEditor } from '@redlines/editor';
import { parse, type MarkKind } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { BROWSER_IDENTITY } from './host.ts';
import sample from './sample.md?raw';

const parsed = parse(sample);
const people = new Map(parsed.ledger.people.map((person) => [person.handle, person]));
const marksBy = (handle: string, kind: MarkKind) =>
  parsed.marks.filter((mark) => mark.entry.by === handle && mark.kind === kind);

describe('the welcome document (sample.md)', () => {
  it('parses without a warning, so no marker starts a line', () => {
    expect(parsed.warnings).toEqual([]);
  });

  it('has an edit by the person using the app in the browser', () => {
    const you = people.get(BROWSER_IDENTITY.handle);
    expect(you?.name).toBe(BROWSER_IDENTITY.name);
    expect(you?.email).toBe(BROWSER_IDENTITY.email);
    expect(marksBy(BROWSER_IDENTITY.handle, 'ins')).not.toHaveLength(0);
  });

  it('has an insertion, a deletion and a substitution by another person', () => {
    const others = [...people.values()].filter(
      (person) => person.handle !== BROWSER_IDENTITY.handle && !person.agent,
    );
    const changed = others.find((person) =>
      (['ins', 'del', 'sub'] as const).every((kind) => marksBy(person.handle, kind).length),
    );
    expect(changed).toBeDefined();
  });

  it('has a change by an agent, with its reason', () => {
    const agents = [...people.values()].filter(
      (person) => person.agent && person.handle.startsWith('claude-'),
    );
    const changes = parsed.marks.filter(
      (mark) => agents.some((agent) => agent.handle === mark.entry.by) && mark.kind !== 'cmt',
    );
    expect(changes).not.toHaveLength(0);
    expect(changes.every((mark) => mark.entry.note)).toBe(true);
  });

  it('has a comment thread with a reply, and a highlight', () => {
    expect(parsed.ledger.comments.some((thread) => thread.replies.length > 0)).toBe(true);
    expect(parsed.marks.some((mark) => mark.kind === 'hl')).toBe(true);
  });

  it('comes back byte for byte from an editor that opened it', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: '', author: BROWSER_IDENTITY });
    editor.setDoc(sample);
    expect(editor.getDoc()).toBe(sample);
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', tracking: false });
    editor.destroy();
  });
});
