// The harness itself: that a journey can start a document, type, paste and look. These stay small
// and guard the journeys' own tools, not the app.

import { expect, test } from '../src/journey.ts';

test('starts with a given document, tracking and view', async ({ start }) => {
  const j = await start({ doc: 'Hello world\n', tracking: true, view: 'redlines' });
  expect(await j.text()).toBe('Hello world\n');
  const ui = await j.uiState();
  expect(ui['tracking']).toBe(true);
  expect(ui['view']).toBe('redlines');
});

test('types at human speed and in a burst', async ({ start }) => {
  const j = await start({ doc: '\n', tracking: false });
  await j.caretAtStart();
  await j.type('ab');
  await j.burst('cd');
  expect(await j.text()).toBe('abcd\n');
  expect((await j.caret()).column).toBe(4);
});

test('pastes plain text', async ({ start }) => {
  const j = await start({ doc: 'one\n', tracking: false });
  await j.caretAfter('one');
  await j.paste(' two');
  expect(await j.text()).toBe('one two\n');
});

test('places the caret, clicks text, and takes a named screenshot', async ({ start }) => {
  const j = await start({ doc: 'alpha beta gamma\n' });
  await j.click('gamma');
  await j.type('X', 'burst');
  expect(await j.text()).toContain('X');
  const path = await j.shot('harness');
  expect(path).toMatch(/harness\.png$/);
});
