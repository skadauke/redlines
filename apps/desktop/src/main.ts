import { createEditor } from '@redlines/editor';
import { applyTheme } from '@redlines/themes';
import '@redlines/themes/fonts.css';
import '@redlines/themes/tokens.css';
import './styles.css';

const sample = `# Launch plan

Redlines keeps every change in the **plain Markdown file**, so the page reads as a finished document while you write it. Syntax such as \`**bold**\` appears only around the caret, in a quiet gray, and *italics*, ~~struck text~~ and [links](https://example.com) look as they will.

## What ships in April

- The importer, for Word and Google Docs files
- Tracked changes and comments, stored in the file as HTML comments that other Markdown tools hide, so a document with pending changes still reads cleanly everywhere
  - Each author in a color of their own
  - Agents with a badge
- A review bar that opens when you ask for it

1. Write the draft
2. Ask for review
3. Accept or reject each change

> Color means a person. Text and controls are grays, so a change stands out from everything around it.

| Milestone | Owner | Date |
| --- | --- | ---: |
| Importer | Ada | April 3 |
| Review bar | Bo | April 17 |
| **Launch** | Everyone | April 28 |

### Saving

Opening and saving a file without editing it leaves it byte for byte the same:

\`\`\`sh
redlines view plan.md --review
\`\`\`

---

The file format is plain Markdown with comments, so it works with git and every other tool.
`;

const dark = matchMedia('(prefers-color-scheme: dark)');
const followSystem = () =>
  applyTheme(document.documentElement, 'default', dark.matches ? 'dark' : 'light');
followSystem();
dark.addEventListener('change', followSystem);

const parent = document.querySelector<HTMLElement>('#editor');
if (!parent) throw new Error('index.html has no #editor element');
createEditor(parent, { doc: sample, author: { handle: 'you', name: 'You' } });
