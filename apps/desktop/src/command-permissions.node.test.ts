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
  { capability: 'default', entry: 'main.ts' },
  { capability: 'preferences', entry: 'preferences/main.ts' },
  { capability: 'install', entry: 'install/main.ts' },
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

/** The app commands a capability file grants (`allow-set-appearance` is `set_appearance`). */
function grantedCommands(capability: string): string[] {
  const file = JSON.parse(
    readFileSync(join(tauri, 'capabilities', `${capability}.json`), 'utf8'),
  ) as {
    permissions: unknown[];
  };
  return sorted(
    file.permissions
      .filter((permission): permission is string => typeof permission === 'string')
      .filter((permission) => permission.startsWith('allow-'))
      .map((permission) => snake(permission.slice('allow-'.length))),
  );
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** A relative import's file, or nothing for a package. */
function resolveImport(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Every file of the app's own code that an entry point reaches, tests aside. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(here, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !file.endsWith('.ts')) continue;
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
      .filter((file) => /@tauri-apps\/api\/core/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repo, file));
    expect(strays).toEqual([]);
  });
});
