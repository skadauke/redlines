// The window that asks, before the app's own window opens, whether to install Redlines from its
// disk image. The app opens it hidden; it shows itself once it is styled.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadSettings } from '../settings.ts';
import { followTheme } from '../window-theme.ts';
import { askQuestion } from './question.ts';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './question.css';

const isTauri = '__TAURI_INTERNALS__' in window;

// The theme and appearance the person picked, as in the app's windows (window-theme.ts).
followTheme(document.documentElement, loadSettings(), { inApp: isTauri });

if (isTauri) {
  askQuestion(document, (install) => void invoke('answer_install', { install }));
  // Shown once its font has loaded too, so that it never flashes another.
  await document.fonts.ready;
  await getCurrentWindow().show();
}
