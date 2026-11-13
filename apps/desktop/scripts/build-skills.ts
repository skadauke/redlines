// Writes the copies of the Redlines skill from the one text they all come from, and checks that
// they are what is committed. The skill teaches an agent that a file is a Redlines file, to read it
// with `redlines view --review`, and to change it only through the `redlines` command line, so
// that its edits are tracked suggestions in its name. Claude Code, Codex and OpenClaw each read a
// skill from a folder of their own and in a form of their own (the front matter, how the agent
// names itself), and a person's copies must never drift apart:
//
//   integrations/skill/body.md         the text, with {{who}}, {{as}}, {{agent}} and {{editors}} in it
//   this file                          what differs per agent: the front matter and those four
//   integrations/skill/version.json    the version, and the hash of every copy's text
//
// The copies it writes are what the app installs from Preferences (src-tauri/src/agents/skills.rs
// embeds them) and what the README copies by hand:
//
//   integrations/claude-code/skills/redlines/SKILL.md   Claude Code (a plugin, and ~/.claude/skills)
//   integrations/codex/skills/redlines/SKILL.md          Codex (~/.agents/skills, which OpenClaw reads too)
//   integrations/openclaw/skills/redlines/SKILL.md       OpenClaw (~/.openclaw/skills, and ClawHub)
//   integrations/claude-code/.claude-plugin/plugin.json  the plugin's manifest, at the same version
//
// The last two skills are the same text: an agent that is not Claude names itself, so one copy
// serves Codex and every OpenClaw agent, and the front matter OpenClaw gates on is a key Codex
// ignores.
//
//   node scripts/build-skills.ts          checks the copies, and fails if they differ
//   node scripts/build-skills.ts --write  writes them, and raises the version if the text changed
//
// Run it in apps/desktop, with Node 24 or later, which runs TypeScript as it is.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The agent a copy is for, by how it names itself. */
export type Kind = 'claude' | 'generic';

export interface Copy {
  /** Where the copy goes, below the repository's root. */
  path: string;
  kind: Kind;
  /** The text, without the version it ends with. */
  text: string;
}

export interface Version {
  version: number;
  /** The hash of every copy's text, so that a change of the text can't go without a new version. */
  hash: string;
}

const DESCRIPTION =
  'Use when reading, editing or commenting on a Markdown file that holds Redlines tracked changes and comments (a `<!-- redlines` block at its end, or markers such as `<!--ins k3x9-->` in its text), or when asked to suggest changes in, review or answer comments on such a file.';

const FRONT: Record<Kind, string> = {
  claude: `---\nname: redlines\ndescription: ${DESCRIPTION}\n---\n`,
  // OpenClaw loads the skill only where the `redlines` program is on the PATH
  // (`metadata.openclaw.requires`); Codex ignores a key it doesn't know.
  generic: `---\nname: redlines\ndescription: ${DESCRIPTION}\nmetadata: { "openclaw": { "requires": { "bins": ["redlines"] } } }\n---\n`,
};

/** Who the agent is, and how it gives that to each edit. */
const WHO: Record<Kind, string> = {
  claude:
    'Give every edit `--as claude-<person> --name Claude --for <person>`. `<person>` is the handle of the\n' +
    'person you work for: lowercase letters, digits, `-` and `_`, made from their email (the part\n' +
    'before the `@`) or else their name, with other characters turned into `-`. `Jane.Doe@example.org`\n' +
    'is `jane-doe`. Ask if you are not sure.',
  generic:
    "You write in your own name, not the person's. Give every edit `--as <you>-<person> --name <You> --for <person>`.\n" +
    '`<you>` is your own handle: your name in lowercase letters, digits, `-` and `_`, with other\n' +
    'characters turned into `-` (an agent called Moby is `moby`), and `<You>` is your name as people\n' +
    'write it (`Moby`). `<person>` is the handle of the person you work for: lowercase letters,\n' +
    'digits, `-` and `_`, made from their email (the part before the `@`) or else their name, with\n' +
    'other characters turned into `-`. `Jane.Doe@example.org` is `jane-doe`. Ask if you are not\n' +
    'sure of either.',
};

/** An agent's handle in an example of the review view, as it names an author there. */
const AGENT: Record<Kind, string> = {
  claude: 'claude-ada',
  generic: 'moby-ada',
};

/** The identity flags of an example, as the agent writes them. */
const AS: Record<Kind, string> = {
  claude: '--as claude-ada --name Claude --for ada',
  generic: '--as <you>-ada --name <You> --for ada',
};

/** What the agent must not change the file with. */
const EDITORS: Record<Kind, string> = {
  claude: 'Edit, Write or sed',
  generic: 'an editor tool, `apply_patch`, `sed` or a redirect',
};

/** Where each copy goes, and for which kind of agent. */
const COPIES: { path: string; kind: Kind }[] = [
  { path: 'integrations/claude-code/skills/redlines/SKILL.md', kind: 'claude' },
  { path: 'integrations/codex/skills/redlines/SKILL.md', kind: 'generic' },
  { path: 'integrations/openclaw/skills/redlines/SKILL.md', kind: 'generic' },
];

/** The repository's root, from this file in apps/desktop/scripts. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const BODY = 'integrations/skill/body.md';
const VERSION = 'integrations/skill/version.json';

/** What a copy ends with, which the app reads to tell an older copy from the one it has. */
export const MARKER = /<!-- redlines-skill (\d+) -->\s*$/;

/** The copies' text, without their version. */
export function buildCopies(root: string = ROOT): Copy[] {
  const body = readFileSync(join(root, BODY), 'utf8');
  return COPIES.map(({ path, kind }) => ({
    path,
    kind,
    text:
      `${FRONT[kind]}\n` +
      body
        .replaceAll('{{who}}', WHO[kind])
        .replaceAll('{{agent}}', AGENT[kind])
        .replaceAll('{{as}}', AS[kind])
        .replaceAll('{{editors}}', EDITORS[kind]),
  }));
}

/** The hash of what every copy says, whatever its version. */
export function hashOf(copies: readonly Copy[]): string {
  const all = createHash('sha256');
  for (const { path, text } of copies) all.update(`${path}\0${text}\0`);
  return all.digest('hex').slice(0, 16);
}

export function readVersion(root: string = ROOT): Version {
  return JSON.parse(readFileSync(join(root, VERSION), 'utf8')) as Version;
}

/** A copy as it is committed and installed: its text and the version it ends with. */
export function withVersion(copy: Copy, version: number): string {
  return `${copy.text}\n<!-- redlines-skill ${version} -->\n`;
}

/** Where the Claude Code plugin's manifest goes: the plugin is `integrations/claude-code`. */
export const PLUGIN = 'integrations/claude-code/.claude-plugin/plugin.json';

/**
 * The plugin's manifest. Its version follows the skill's, so that an installed plugin updates when
 * the skill changes and not otherwise (a plugin without one updates with every commit).
 */
export function pluginManifest(version: number): string {
  const manifest = {
    name: 'redlines',
    version: `0.${version}.0`,
    description:
      'Teaches Claude Code to read a Redlines file with its review view and to change it only through the redlines command line, so that its edits are tracked suggestions in its name.',
    author: { name: 'skadauke', url: 'https://github.com/skadauke' },
    homepage: 'https://www.redlines.md/',
    repository: 'https://github.com/skadauke/redlines',
    license: 'MIT',
    keywords: ['markdown', 'tracked-changes', 'comments', 'review'],
  };
  // As Prettier writes JSON, which `pnpm format:check` holds it to: a short list on one line.
  const text = JSON.stringify(manifest, null, 2).replace(
    /\[\n\s+([^\]]*?)\n\s+\]/g,
    (_list, items: string) => `[${items.replace(/,\n\s+/g, ', ')}]`,
  );
  return `${text}\n`;
}

/** The files as they should be, by path, for a version. */
export function filesFor(copies: readonly Copy[], version: Version): Map<string, string> {
  const files = new Map(copies.map((copy) => [copy.path, withVersion(copy, version.version)]));
  files.set(PLUGIN, pluginManifest(version.version));
  files.set(VERSION, `${JSON.stringify(version, null, 2)}\n`);
  return files;
}

/** Whether the files in `root` are those for `version`; the paths of those that aren't. */
export function differences(root: string, copies: readonly Copy[], version: Version): string[] {
  const wrong: string[] = [];
  for (const [path, text] of filesFor(copies, version)) {
    let found: string | undefined;
    try {
      found = readFileSync(join(root, path), 'utf8');
    } catch {
      found = undefined;
    }
    if (found !== text) wrong.push(path);
  }
  return wrong;
}

function main(): void {
  const write = process.argv.includes('--write');
  const copies = buildCopies();
  const recorded = readVersion();
  const hash = hashOf(copies);
  // A new text is a new version: an installed copy is older than the app's until it is updated.
  const version: Version =
    recorded.hash === hash ? recorded : { version: recorded.version + 1, hash };
  if (write) {
    for (const [path, text] of filesFor(copies, version)) {
      mkdirSync(dirname(join(ROOT, path)), { recursive: true });
      writeFileSync(join(ROOT, path), text);
    }
    console.log(`The skill is version ${version.version}.`);
    return;
  }
  const wrong = differences(ROOT, copies, version);
  if (wrong.length > 0 || recorded.hash !== hash) {
    console.error(
      `The copies of the skill aren't what integrations/skill/body.md and scripts/build-skills.ts make: ${wrong.join(', ') || 'the version'}.\n` +
        'Run `node scripts/build-skills.ts --write` in apps/desktop.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
