// The running app's icon. The installed icon is the caret; while the app runs, its Dock icon (the
// window's, where there is no Dock) shows a different mark of the icon family at every launch,
// unless the person keeps the caret. The app does the rotating (src-tauri/src/dock_icon.rs); the
// person's choice is in the settings, and the app is told of it, so that it knows before there is a
// window to ask.

import { emit } from '@tauri-apps/api/event';

/** The event that tells the app whether the icon rotates; its payload is `true` or `false`. */
export const ICON_ROTATION_EVENT = 'icon-rotation';

/** The settings item's label: the Dock is the Mac's, and elsewhere the icon is the window's. */
export function iconRotationLabel(userAgent: string = navigator.userAgent): string {
  return userAgent.includes('Macintosh') ? 'Rotate the Dock Icon' : 'Rotate the Window Icon';
}

/** Tells the app whether the icon rotates (`true`) or stays the caret (`false`). */
export function reportIconRotation(rotate: boolean): void {
  emit(ICON_ROTATION_EVENT, rotate).catch((error: unknown) => {
    console.error('Could not tell the app whether the icon rotates', error);
  });
}
