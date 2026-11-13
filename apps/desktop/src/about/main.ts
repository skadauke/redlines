// The About Redlines window: the app's icon, its name, its version and build, and the copyright. A
// click on the icon changes it to the next mark of the icon family, drawn as a tracked change
// (marks.ts), and the Dock icon follows until the next launch. The app opens the window hidden; it
// shows itself once it is styled. Escape closes it, as ⌘W does (the menu's Close).

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { COPYRIGHT, loadAbout, versionLine, type About } from '../about.ts';
import { loadSettings } from '../settings.ts';
import { followTheme } from '../window-theme.ts';
import { createIconCycler, markOrCaret, type Mark } from './marks.ts';
import changeBar from '../../src-tauri/icons/family/change-bar.png';
import caretInsertion from '../../src-tauri/icons/family/caret-insertion.png';
import caret from '../../src-tauri/icons/family/caret.png';
import deleteMark from '../../src-tauri/icons/family/delete-mark.png';
import marginBracket from '../../src-tauri/icons/family/margin-bracket.png';
import redline from '../../src-tauri/icons/family/redline.png';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './about.css';

const isTauri = '__TAURI_INTERNALS__' in window;

/** The marks' pictures, which the app's own resources hold as the Dock's (`icons/family`). */
const URLS: Record<Mark, string> = {
  caret,
  'change-bar': changeBar,
  'margin-bracket': marginBracket,
  'delete-mark': deleteMark,
  redline,
  'caret-insertion': caretInsertion,
};

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`about.html has no #${id}`);
  return found;
}

// The theme and appearance the person picked, as in the app's windows (window-theme.ts). The app
// took the appearance before it opened this window (src-tauri/src/appearance.rs): this one has
// nothing to set.
followTheme(document.documentElement, loadSettings(), {});

// A plain browser has no app to ask.
const about: About = isTauri
  ? await loadAbout().catch((error: unknown) => {
      console.error('Could not read the build tag for About Redlines', error);
      return { name: 'Redlines', version: '', build: '' };
    })
  : { name: 'Redlines', version: '0.0.0-dev', build: 'browser' };
element('name').textContent = about.name;
element('version').textContent = about.version ? versionLine(about) : '';
element('copyright').textContent = COPYRIGHT;

/** The mark the app's icon shows now, which this one starts on. */
const start = isTauri
  ? await invoke<string>('app_icon_mark').then(markOrCaret, () => markOrCaret(''))
  : markOrCaret('');

// Every mark loads now, so that none is still arriving when the change is drawn.
for (const url of Object.values(URLS)) new Image().src = url;

const cycler = createIconCycler(element('icon'), {
  urls: URLS,
  start,
  reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  show: (mark) => {
    if (!isTauri) return;
    invoke('show_app_icon_mark', { name: mark }).catch((error: unknown) => {
      console.error('Could not show the mark as the app’s icon', error);
    });
  },
});
element('icon').addEventListener('click', () => cycler.click());

if (isTauri) {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void getCurrentWindow().close();
  });
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
