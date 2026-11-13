import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the Rust compiler's output visible during `tauri dev`.
  clearScreen: false,
  server: {
    // Tauri loads the frontend from this port (build.devUrl in src-tauri/tauri.conf.json).
    port: 1420,
    strictPort: true,
    watch: {
      // The second is this app's `redlines` crate only, as the repository may be in a folder of
      // that name.
      ignored: ['**/src-tauri/**', '**/apps/desktop/redlines/**'],
    },
  },
  build: {
    rollupOptions: {
      // The app's window, the window that asks to install the app from its disk image, Preferences
      // and About Redlines.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        install: resolve(import.meta.dirname, 'install.html'),
        preferences: resolve(import.meta.dirname, 'preferences.html'),
        about: resolve(import.meta.dirname, 'about.html'),
      },
    },
  },
});
