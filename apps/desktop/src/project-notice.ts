// The notice for a file whose folder is the home folder or above (#451): such a folder is no
// project, so the file opens on its own, and the notice says why there is no folder in the sidebar.

import type { ProjectRoot } from '@redlines/plugin-api';
import type { NotificationOptions } from './ui/notifications.ts';

export const TOO_BROAD_NOTICE =
  'This file is in your home folder or above, which is too much of your disk to take as a project. It opens on its own, without a folder.';

/** The notice to show for the project of a document, or null when it is a project. */
export function tooBroadNotice(root: ProjectRoot): NotificationOptions | null {
  return root.tooBroad
    ? { key: 'project-too-broad', text: TOO_BROAD_NOTICE, timeout: 8000 }
    : null;
}
