import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests sit next to the code they test and run in Node. A test file that needs a DOM starts
    // with a `@vitest-environment happy-dom` comment.
    include: [
      '{apps,packages,plugins}/*/src/**/*.test.ts',
      // The Quick Look renderer, a package inside the desktop app (apps/desktop/quicklook).
      'apps/desktop/quicklook/src/**/*.test.ts',
    ],
    // A stylesheet imported as text (`file.css?raw`, as the Quick Look renderer does) is its text.
    // Vitest otherwise blanks every stylesheet.
    css: { include: /\.css\?raw$/ },
  },
});
