// Each window may call the app's own commands (src-tauri/src/lib.rs, `generate_handler!`) that its
// code calls, and no others. Tauri refuses a command that no capability grants once `build.rs`
// lists it in the app manifest; what this test keeps in step is the three things a person could
// change without the others: the commands the app registers, the list in `build.rs`, and each
// window's capability file against the commands that window's code (its entry point and
// everything it imports) names.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tauri = resolve(here, '../src-tauri');
const repo = resolve(here, '../../..');

/** The windows' capability files, and the page entry point of the windows each one covers. */
const WINDOWS = [
  { capability: 'default', entry: 'main.ts', windows: ['main', 'doc-*'] },
  { capability: 'preferences', entry: 'preferences/main.ts', windows: ['preferences'] },
  { capability: 'install', entry: 'install/main.ts', windows: ['install'] },
];

const snake = (kebab: string) => kebab.replaceAll('-', '_');
const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

/** The commands `generate_handler!` registers, by name. */
function registeredCommands(): string[] {
  const source = readFileSync(join(tauri, 'src/lib.rs'), 'utf8');
  const list = /generate_handler!\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? '';
  const names = list
    .split(',')
    .map((entry) => entry.replace(/#\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .map((path) => path.split('::').at(-1) ?? '');
  return sorted(names);
}

/** The commands `build.rs` lists in the app manifest. */
function manifestCommands(): string[] {
  const source = readFileSync(join(tauri, 'build.rs'), 'utf8');
  const list = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
  return sorted([...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? ''));
}

/** A capability file: the windows it covers and its permissions. */
function readCapability(capability: string): { windows: string[]; permissions: string[] } {
  const file = JSON.parse(
    readFileSync(join(tauri, 'capabilities', `${capability}.json`), 'utf8'),
  ) as { windows: string[]; permissions: unknown[] };
  return {
    windows: file.windows,
    permissions: file.permissions.filter(
      (permission): permission is string => typeof permission === 'string',
    ),
  };
}

/** The app commands a capability file grants (`allow-set-appearance` is `set_appearance`). */
function grantedCommands(capability: string): string[] {
  return sorted(
    readCapability(capability)
      .permissions.filter((permission) => permission.startsWith('allow-'))
      .map((permission) => snake(permission.slice('allow-'.length))),
  );
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Files that are imported for what they hold, not for code that could call a command. */
const ASSETS = /\.(css|md|json|svg|png|woff2?|ttf)$/;

/**
 * A relative import's file, as the bundler finds it: `.js` for a `.ts` file, a missing extension,
 * `.tsx`, a folder's `index`, and a `?raw` or other query dropped. Nothing for a package. An import
 * that leads to no file stops the test, so that no file is skipped unseen.
 */
function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''));
  const stem = base.replace(/\.(js|jsx|mjs)$/, '');
  const candidates = [
    base,
    ...['.ts', '.tsx'].map((extension) => `${base}${extension}`),
    ...['.ts', '.tsx'].map((extension) => `${stem}${extension}`),
    ...['index.ts', 'index.tsx'].map((index) => join(base, index)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${relative(repo, from)} imports ${specifier}, which no file answers to`);
}

/** Every file of the app's own code that an entry point reaches, tests aside. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(here, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || ASSETS.test(file)) continue;
    seen.add(file);
    const source = withoutComments(readFileSync(file, 'utf8'));
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    for (const specifier of specifiers) {
      const next = resolveImport(file, specifier);
      if (next !== undefined) queue.push(next);
    }
  }
  return [...seen].sort();
}

/**
 * The registered commands that a window's code names as the first argument of a call, as
 * `invoke('name')` does, or `startThrough('name', ...)` and the like, which pass it on.
 */
function calledCommands(entry: string, registered: string[]): string[] {
  const called = new Set<string>();
  for (const file of reachable(entry)) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const name of registered) {
      if (new RegExp(`\\(\\s*['"]${name}['"]`).test(source)) called.add(name);
    }
  }
  return sorted(called);
}

/** Every TypeScript source in a folder, tests and dependencies aside. */
function sources(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'target', 'dist'].includes(entry.name) ? [] : sources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the app commands each window may call', () => {
  const registered = registeredCommands();

  it('registers the commands that build.rs lists in the manifest', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(manifestCommands()).toEqual(registered);
  });

  for (const { capability, entry } of WINDOWS) {
    it(`grants the ${capability} windows the commands they call, and no others`, () => {
      const called = calledCommands(entry, registered);
      expect(called.length).toBeGreaterThan(0);
      expect(grantedCommands(capability)).toEqual(called);
    });
  }

  for (const { capability, windows } of WINDOWS) {
    it(`covers the ${capability} windows by label, and denies no command`, () => {
      const file = readCapability(capability);
      expect(file.windows).toEqual(windows);
      // A deny would take back a grant the lists above show, unseen by them.
      expect(file.permissions.filter((permission) => /(^|:)deny-/.test(permission))).toEqual(
        capability === 'default' ? ['fs:deny-default'] : [],
      );
    });
  }

  it('has a capability file for no window beyond these', () => {
    const files = readdirSync(join(tauri, 'capabilities'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''));
    expect(sorted(files)).toEqual(sorted(WINDOWS.map(({ capability }) => capability)));
  });

  it('calls the app only from the desktop app', () => {
    // A command named in a plugin or a package would be one that no window above accounts for.
    const strays = ['packages', 'plugins']
      .flatMap((folder) => sources(join(repo, folder)))
      .filter((file) =>
        /@tauri-apps\/api\/core|__TAURI_INTERNALS__|__TAURI__/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(repo, file));
    expect(strays).toEqual([]);
  });
});
