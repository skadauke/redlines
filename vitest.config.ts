import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests sit next to the code they test and run in Node. A test file that needs a DOM starts
    // with a `@vitest-environment happy-dom` comment.
    include: ['{apps,packages,plugins}/*/src/**/*.test.ts'],
  },
});
