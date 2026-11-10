import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Code and config only: the docs are prose, and the website has its own tooling.
  globalIgnores([
    'docs/',
    'website/',
    '**/dist/',
    '**/coverage/',
    'apps/desktop/src-tauri/target/',
    'apps/desktop/src-tauri/gen/',
    'apps/desktop/src-tauri/permissions/',
    'apps/desktop/redlines/bundle/',
    'apps/desktop/redlines/target/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Each file is checked with the nearest tsconfig.json.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Shared code, and the two embeds that bundle it, run in any host (the desktop app, a React component, an editor extension), so
    // it never reaches for Tauri. Anything host-specific arrives through a `Host` capability.
    files: [
      'packages/**/*.{ts,tsx}',
      'plugins/**/*.{ts,tsx}',
      'apps/embed-smoke/**/*.ts',
      'apps/website-embed/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message: 'Shared code does not import Tauri. Use a Host capability instead.',
            },
          ],
        },
      ],
      // The same ban for `import('@tauri-apps/...')`, which the rule above does not see.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^@tauri-apps/]',
          message: 'Shared code does not import Tauri. Use a Host capability instead.',
        },
      ],
    },
  },
);
