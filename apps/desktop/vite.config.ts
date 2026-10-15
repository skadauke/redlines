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
});
