// What an agent can really read at "This folder and my home folder", with the real programs: the
// command lines the providers write (`claudeArgs`, `codexArgs`), run against a scratch home folder
// that has what a real one has: visible folders, a `~/Documents` that is a link into a cloud folder,
// hidden folders, a `.env`, and `~/Library` with Mail in it beside the cloud folders. A file inside
// the scope is read, and a file in a hidden folder, a `.env`, and `~/Library`'s own are refused.
//
// It needs the programs and, for Claude, a sign-in, and a Claude run costs a cent or two, so it is
// off unless asked for, and no part of CI:
//
//   REDLINES_REAL_AGENTS=codex,claude pnpm vitest run apps/desktop/src/agent-limits.real.node.test.ts
//
// The checks are for the versions the providers were tested with (MIN_VERSION of each plugin): a
// newer one that changes how a limit reads is what this is for. Nothing here reads a credential or
// signs anything in; the Claude run says so in its prompt and sees only the scratch folder.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRequest, McpEndpoint } from '@redlines/plugin-api';
import { claudeArgs } from '../../../plugins/agent-claude/src/index.ts';
import { codexArgs } from '../../../plugins/agent-codex/src/index.ts';

const asked = new Set((process.env['REDLINES_REAL_AGENTS'] ?? '').split(',').map((s) => s.trim()));
const programs = {
  codex: '/opt/homebrew/bin/codex',
  claude: `${process.env['HOME']}/.local/bin/claude`,
};

/** What the scratch home holds, by path below it, and what each file says. */
const FILES: Record<string, string> = {
  'code/project/note.md': 'PROJECT-NOTE-HERON',
  'code/other/reference.md': 'OTHER-PROJECT-OTTER',
  'code/project/.env': 'DOTENV-SECRET-FALCON',
  'code/project/.git/config': 'GIT-CONFIG-LYNX',
  '.ssh/id_fake': 'SSH-KEY-SECRET-MARTEN',
  'Library/Mail/mail.txt': 'MAIL-SECRET-BADGER',
  'Library/CloudStorage/Dropbox/Documents/dropbox-doc.md': 'DROPBOX-DOC-PLOVER',
  'Library/Mobile Documents/com~apple~CloudDocs/icloud-doc.md': 'ICLOUD-DOC-WREN',
};

/** What a file below the scratch home must do at the home folder scope. */
const EXPECTED: [path: string, readable: boolean][] = [
  ['code/project/note.md', true],
  ['code/other/reference.md', true],
  // The link in the home folder, which leads into the cloud folder.
  ['Documents/dropbox-doc.md', true],
  ['Library/CloudStorage/Dropbox/Documents/dropbox-doc.md', true],
  ['Library/Mobile Documents/com~apple~CloudDocs/icloud-doc.md', true],
  ['.ssh/id_fake', false],
  ['Library/Mail/mail.txt', false],
  ['code/project/.env', false],
  ['code/project/.git/config', false],
];

const roots = { home: '', work: '', scratch: '' };
let reach: { home: string; roots: string[] };

/** The folders to grant, as `reach.rs` makes them: visible folders but Library, and the cloud folders. */
function rootsOf(home: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(home)) {
    if (name.startsWith('.') || name === 'Library') continue;
    const path = join(home, name);
    if (!statSync(path).isDirectory()) continue;
    found.push(path);
    const real = realpathSync(path);
    if (real !== path) found.push(real);
  }
  for (const cloud of ['CloudStorage', 'Mobile Documents']) {
    const path = join(home, 'Library', cloud);
    if (existsSync(path)) found.push(path);
  }
  return [...new Set(found)].sort();
}

function makeHome(): void {
  roots.scratch = realpathSync(mkdtempSync(join(tmpdir(), 'redlines-limits-')));
  roots.home = join(roots.scratch, 'home');
  roots.work = join(roots.scratch, 'work');
  mkdirSync(roots.work, { recursive: true });
  for (const [path, words] of Object.entries(FILES)) {
    const file = join(roots.home, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${words}\n`);
  }
  // ~/Documents is a link into a cloud folder, as it often is.
  symlinkSync(
    join(roots.home, 'Library/CloudStorage/Dropbox/Documents'),
    join(roots.home, 'Documents'),
  );
  reach = { home: roots.home, roots: rootsOf(roots.home) };
}

beforeAll(() => {
  if (asked.size > 0) makeHome();
});
afterAll(() => {
  if (roots.scratch) rmSync(roots.scratch, { recursive: true, force: true });
});

const tools: McpEndpoint = { command: '/usr/bin/true', args: [] };
const request = (): AgentRequest => ({
  prompt: 'x',
  systemPrompt: 'x',
  thread: 't1',
  documentPath: join(roots.home, 'code/project/note.md'),
  folder: join(roots.home, 'code/project'),
  scope: 'everything',
  homeFolder: reach.home,
  homeRoots: reach.roots,
  author: { handle: 'a-b', name: 'A', for: 'b' },
});

describe.skipIf(!asked.has('codex'))('Codex at This folder and my home folder', () => {
  /** Whether a read of `path` works inside the sandbox of the profile `codexArgs` writes. */
  function reads(path: string): boolean {
    const profile = codexArgs(request(), tools, {
      folder: join(roots.home, 'code/project'),
      programFolders: ['/opt/homebrew/bin'],
    }).find((arg) => arg.startsWith('permissions.redlines.filesystem='));
    expect(profile).toBeDefined();
    const ran = spawnSync(
      programs.codex,
      [
        'sandbox',
        '-P',
        'redlines',
        '-c',
        profile ?? '',
        '-C',
        join(roots.home, 'code/project'),
        '--',
        '/bin/cat',
        path,
      ],
      // A codex home of its own: nothing of the person's is read, and nothing is signed in.
      { env: { ...process.env, CODEX_HOME: join(roots.scratch, 'codex-home') }, encoding: 'utf8' },
    );
    return ran.status === 0;
  }

  beforeAll(() => mkdirSync(join(roots.scratch, 'codex-home'), { recursive: true }));

  for (const [path, readable] of EXPECTED) {
    it(`${readable ? 'reads' : 'refuses'} ~/${path}`, () => {
      expect(reads(join(roots.home, path))).toBe(readable);
    }, 60_000);
  }
});

describe.skipIf(!asked.has('claude'))('Claude at This folder and my home folder', () => {
  it('reads what is inside and refuses what is left out, as one real run says', () => {
    const args = claudeArgs(
      {
        ...request(),
        prompt:
          'Read each of these files with the Read tool, one call each, in this order, and then reply with the word DONE. If a read is refused, go on with the next file. Do not use any other tool.\n' +
          EXPECTED.map(([path]) => join(roots.home, path)).join('\n'),
      },
      tools,
    );
    // A small model, and a bounded run; the rest of the line is the provider's own.
    args.splice(args.indexOf('--'), 0, '--model', 'haiku', '--max-turns', '16');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name !== 'CLAUDECODE' &&
          !name.startsWith('CLAUDE_CODE_') &&
          name !== 'ANTHROPIC_BASE_URL',
      ),
    );
    const ran = spawnSync(programs.claude, args, {
      cwd: join(roots.home, 'code/project'),
      env,
      encoding: 'utf8',
      timeout: 240_000,
    });
    // What each Read came to: the path it was asked for, and whether it was refused.
    const reads = new Map<string, { id: string; refused?: boolean }>();
    const calls = new Map<string, string>();
    for (const line of ran.stdout.split('\n')) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const content = (event['message'] as { content?: unknown[] } | undefined)?.content ?? [];
      for (const block of content as Record<string, unknown>[]) {
        if (block['type'] === 'tool_use' && block['name'] === 'Read') {
          const file = (block['input'] as { file_path?: string }).file_path ?? '';
          calls.set(String(block['id']), file);
          reads.set(file, { id: String(block['id']) });
        }
        if (block['type'] === 'tool_result') {
          const file = calls.get(String(block['tool_use_id']));
          if (file !== undefined) {
            const seen = reads.get(file);
            if (seen) seen.refused = block['is_error'] === true;
          }
        }
      }
    }
    for (const [path, readable] of EXPECTED) {
      const seen = reads.get(join(roots.home, path));
      expect(seen, `${path} was never read at all: ${ran.stdout.slice(-400)}`).toBeDefined();
      expect(seen?.refused === true, `~/${path}`).toBe(!readable);
    }
  }, 300_000);
});
