// The window that asks, before the app's own window opens, whether to install Redlines from its
// disk image. The app opens it hidden; it shows itself once it is styled.

import { applyTheme, type Appearance } from '@redlines/themes';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { currentAppearance, loadSettings, shownTheme, watchAppearance } from '../settings.ts';
import { askQuestion } from './question.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './question.css';

// The theme and appearance the person picked, as in the app's window.
const settings = loadSettings();
const showTheme = (system: Appearance) => {
  const shown = shownTheme(settings, system);
  applyTheme(document.documentElement, shown.theme, shown.appearance);
};
showTheme(currentAppearance());
watchAppearance(showTheme);

if ('__TAURI_INTERNALS__' in window) {
  askQuestion(document, (install) => void invoke('answer_install', { install }));
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
