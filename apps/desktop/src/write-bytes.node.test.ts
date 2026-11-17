// @vitest-environment happy-dom
// The window writes a Word file with the file plugin's text command, which takes the bytes as the
// body of the request and writes them as they are (tauri-plugin-fs `write_file_inner`: the body is
// `InvokeBody::Raw`, `write_all`, no text decoding; `write_text_file` is the same function). The
// plugin isn't running here: `invoke` is stood in for by what the plugin does with the request, so
// this holds the page's half, that the bytes reach the request untouched and under the header the
// plugin reads the path from, and that a file written so opens as the zip it is.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportDocx, readParts } from '@redlines/word';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { command: string; body: unknown; path: string }[] = [];

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invoke: (command: string, body: Uint8Array, options: { headers: { path: string } }) => {
    // What the plugin does: the path from the header, percent-decoded, and the raw body written.
    const path = decodeURIComponent(options.headers.path);
    calls.push({ command, body, path });
    writeFileSync(path, body);
    return Promise.resolve();
  },
}));

const { writeBytes } = await import('./host.ts');

let folder = '';
beforeEach(async () => {
  calls.length = 0;
  folder = await mkdtemp(join(tmpdir(), 'redlines-write-bytes-'));
});
afterEach(() => rm(folder, { recursive: true }));

describe('writing bytes through the text command', () => {
  it('sends the bytes themselves, and the file holds every one of them', async () => {
    // A NUL, 0xFF, an invalid UTF-8 pair, a byte order mark, and every byte value.
    const bytes = Uint8Array.from([
      0x00,
      0xff,
      0xc3,
      0x28,
      0xef,
      0xbb,
      0xbf,
      0xfe,
      ...Array.from({ length: 256 }, (_, i) => i),
    ]);
    const path = join(folder, 'odd name (1).bin');
    await writeBytes(path, bytes);
    expect(calls[0]?.command).toBe('plugin:fs|write_text_file');
    // The same bytes, not a string and not a copy that was decoded and encoded again.
    expect(calls[0]?.body).toBe(bytes);
    expect(calls[0]?.path).toBe(path);
    const back = new Uint8Array(await readFile(path));
    expect([...back]).toEqual([...bytes]);
  });

  it('writes a real .docx that opens as the zip it is, byte for byte', async () => {
    const docx = await exportDocx('Hello **world**, with a [link](https://example.org/a).\n');
    const path = join(folder, 'out.docx');
    await writeBytes(path, docx);
    const back = new Uint8Array(await readFile(path));
    expect(back.length).toBe(docx.length);
    expect([...back]).toEqual([...docx]);
    expect(Object.keys(readParts(back))).toContain('word/document.xml');
  });
});
