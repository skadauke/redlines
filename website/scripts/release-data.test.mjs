import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from './release-data.mjs';

const release = (tag, version) => ({ tag, version, publishedAt: '2026-11-01T00:00:00Z', assets: {} });

test('the empty state is valid', () => {
  assert.doesNotThrow(() => validate({ tag: null, version: null, publishedAt: null, assets: {} }));
});

test('a release and a pre-release tag are valid', () => {
  assert.doesNotThrow(() => validate(release('v0.2.0', '0.2.0')));
  assert.doesNotThrow(() => validate(release('v0.3.0-rc.1', '0.3.0-rc.1')));
});

test('a tag without its v is refused', () => {
  assert.throws(() => validate(release('0.2.0', '0.2.0')), /lib\/release.json/);
});

test('a tag that is not v and three numbers is refused', () => {
  assert.throws(() => validate(release('v0.2', '0.2')), /lib\/release.json/);
});

test("a version that is not the tag's is refused", () => {
  assert.throws(() => validate(release('v0.2.0', '0.2.1')), /lib\/release.json/);
});
