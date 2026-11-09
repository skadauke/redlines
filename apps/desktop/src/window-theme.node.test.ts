// Every window asks the app for the appearance of the windows (window-theme.ts), which Tauri lets
// a window do only when its capability grants the permission. These read the capabilities and the
// windows as files, as Tauri does when it builds the app.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Capability {
  identifier: string;
  windows: string[];
  permissions: (string | { identifier: string })[];
}

const folder = new URL('../src-tauri/capabilities/', import.meta.url);
const capabilities = readdirSync(folder)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(new URL(name, folder), 'utf8')) as Capability);
const config = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { app: { windows: { label: string }[] } };

/** Whether a capability's window, such as `doc-*`, is the window `label`. */
function names(pattern: string, label: string): boolean {
  const escaped = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`).test(label);
}

/** The permissions the capabilities give the window `label`. */
function permissionsOf(label: string): string[] {
  return capabilities
    .filter(({ windows }) => windows.some((pattern) => names(pattern, label)))
    .flatMap(({ permissions }) =>
      permissions.map((permission) =>
        typeof permission === 'string' ? permission : permission.identifier,
      ),
    );
}

describe('the windows’ capabilities', () => {
  it('let every window set the appearance of the app', () => {
    // The windows tauri.conf.json describes, and a document window opened later (windows.rs).
    const labels = [...config.app.windows.map(({ label }) => label), 'doc-2'];
    expect(labels).toEqual(expect.arrayContaining(['main', 'install', 'preferences', 'doc-2']));
    for (const label of labels) {
      // `setTheme` of @tauri-apps/api/app, which is Tauri's `set_app_theme` command.
      expect(permissionsOf(label), label).toContain('core:app:allow-set-app-theme');
    }
  });
});
