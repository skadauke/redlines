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
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      // The app's window, and the window that asks to install the app from its disk image.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        install: resolve(import.meta.dirname, 'install.html'),
      },
    },
  },
});
