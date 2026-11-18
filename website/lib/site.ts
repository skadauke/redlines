// The page's copy, in one place. The product name comes from site.config.mjs;
// keep it out of the strings below, so a rename stays a one-line change. The
// illustrations (the components that draw the editor) hold their own sample
// text. Text between backticks is set as code.

import { product } from '../site.config.mjs';
import compareData from './compare.json';

const { name } = product;

/** The name's possessive: "Redlines’", or "Plainsong’s" after a rename. */
const possessive = name.endsWith('s') ? `${name}’` : `${name}’s`;

/** The design spec, the format and the license, on GitHub. */
export const links = {
  designSpec: `${product.repository}/blob/main/docs/design.md`,
  format: `${product.repository}/blob/main/docs/format.md`,
  license: `${product.repository}/blob/main/LICENSE`,
};

const lede = `${name} is a free, open-source Markdown editor for the Mac. What you see is the document: Markdown syntax appears only where the caret is. When a colleague or an AI edits it, every change shows who made it, for you to accept or reject, and all of it stays in the plain Markdown file.`;

export const meta = {
  title: `${name}: the most beautiful Markdown editor. See every change.`,
  description: lede,
};

export const nav = {
  label: 'Sections',
  home: `${name}, back to top`,
  sections: [
    { href: '#ai', label: 'AI documents' },
    { href: '#changes', label: 'Changes' },
    { href: '#compare', label: 'Compare' },
    { href: '#uses', label: 'Use cases' },
    { href: '#developers', label: 'Developers' },
  ],
  download: { href: '#download', label: 'Download' },
};

export const hero = {
  title: 'The most beautiful Markdown editor.',
  titleAccent: 'See every change.',
  lede,
  designSpec: 'Read the design spec',
  download: 'Download',
  github: 'View on GitHub',
  /** Under the buttons until there is a full release. */
  unreleased:
    'The first full release is on its way. Try the editor on this page; the design and the format are on GitHub.',
  /** Under the buttons once there is one: "Version 1.0 for macOS". */
  released: (version: string, platforms: string) => `Version ${version} for ${platforms}`,
};

export const aiDocs = {
  title: 'Markdown is the document format of AI.',
  body: `Plans, specs and reports from agents arrive as \`.md\` files, and most apps show them as code. ${name} shows a formatted document you can edit.`,
  points: [
    'Open any `.md` file and read it formatted, with tables, images, task lists and syntax-colored code. HTML that GitHub draws, such as inline tags and collapsible sections, is drawn the same way.',
    'Edit it like a document: a toolbar you summon with the wrench, for formatting, tables, lists and images, with every command in a searchable palette, find and replace, a file sidebar. Move a block with ⌥↑ and ⌥↓, or drag it to a drop line.',
    'Drop images from Finder, align them, crop them to a copy in your images folder, and let an agent write their alt text. Their sizes are known before they load, so the page doesn’t jump.',
    'Open a Word or Google Docs `.docx` with its tracked changes, comments and pictures, or export to Word with real tracked changes and comments. Copy out to either keeps headings, lists, checklists, tables with their alignment, code and pictures. Pasted in, headings, lists, tables and code arrive as clean Markdown.',
    'Print, or Export as PDF: the document as it reads, set for paper.',
    'Press Space on a Markdown file in Finder, Mail or Spotlight for a preview that shows it as it reads, with a line saying what is waiting in it for review. It comes with the app.',
    'R Markdown and Quarto files open too (`.Rmd`, `.qmd`): fenced divs, callouts, cross-references and code chunks are drawn, and review works the way it does in prose.',
    'Long documents stay quick to scroll and type in. If a crash is caught, your document is recovered.',
    'Switch between Clean, Redlines and Plain from the page icon. Text and code files open in Plain, with syntax colors.',
    'It stays a `.md` file in your repo: agents and git read it, and other Markdown tools show the newest text.',
  ],
};

export const changes = {
  title: 'Review lives in the file.',
  body: `Markdown has no syntax for a tracked change or a comment, and Word and Google Docs, which do, sit outside the repo where agents work. So review moves to a chat or a pull request, and the document shows nothing of what was proposed, by whom, or what’s still open. ${name} keeps each pending change and comment in the plain file, with its author and time, so you and your agents work from the same text. An accepted change becomes ordinary text, and git keeps the earlier versions.`,
  points: [
    'Mention @Claude or @Codex in a comment. A status line shows what it’s doing while you keep typing.',
    'It replies in a few words, and cites the file and line when the answer comes from the code. A click opens that file.',
    'It can comment on other text. Its edits are always tracked changes in its own name, for you to accept or reject.',
    'Each run starts fresh and reads the document and its thread from the file, so a follow-up needs no session and no server.',
    `${name} runs your own Claude Code or Codex, signed in as you. It never sees your Claude or ChatGPT sign-in. Choose a default agent and a model for each one in Preferences; Ask shows which model is answering and lets you pick another.`,
    'An OpenClaw agent, such as one you call Moby, answers a mention and works as itself in the same way, and it can run on another computer: Preferences › Agents › Connect OpenClaw walks you through reaching it over Tailscale. Support for OpenClaw is new, and is still being tried against real setups.',
    `Open one document in a second window, and the two stay in sync, each with its caret named and colored for the other. Undo is each window’s own: it takes back your steps and leaves what the other window typed. ${name} does this on one Mac, not yet between people.`,
    'An edit in a list, a block, code or a table that plain text can’t hold, such as a row or column added or removed, is widened to the unit that holds it and written as a tracked change you can accept or reject, not refused.',
  ],
};

/** What each Redlines row says, and whether each other product has the feature: Word, Google Docs, Notion, VS Code. */
type CompareRow = {
  feature: string;
  redlines: 'built' | 'planned';
  others: readonly [boolean, boolean, boolean, boolean];
};

export const compare = {
  title: `How ${name} compares`,
  body: `What ${name} has built, and what it plans. Other products as of November 2026, from their documentation. VS Code includes the Live Share, GitHub Copilot and Quarto extensions. The first three rows are the ones only ${name} has.`,
  /** Under the table. */
  note: `Live collaboration with AI means an agent that works in the document as itself. In Word and Google Docs, the AI’s edits count as yours. Windows of one Mac can share a document today; until live sessions between people come, people share a ${name} file as they share any file. Word and Google Docs files open with their changes and comments, and export to Word keeps them.`,
  /** The table's scrolling box and the features column, named for screen readers only. */
  table: 'Comparison table',
  feature: 'Feature',
  yes: 'Yes',
  no: 'No',
  planned: 'Planned',
  /** Between the table and the note. */
  legend: [
    { mark: 'yes', text: `Yes. For ${name}: built, it works today.` },
    { mark: 'planned', text: 'Planned: designed, not built yet.' },
    { mark: 'no', text: 'No.' },
  ] as const,
  products: [name, 'Word', 'Google Docs', 'Notion', 'VS Code'],
  /** From compare.json, which docs/design.md §4 holds (npm run compare:check). */
  rows: compareData.rows as unknown as CompareRow[],
};

export const uses = {
  title: 'Wherever documents get reviewed',
  body: `Tracked changes and comments are how contracts, regulated documents and papers get written. ${name} keeps them in plain Markdown, which every tool and agent can read.`,
  cards: [
    {
      title: 'Engineering',
      body: 'Design docs and specs in a code repo. Ask an agent a question that needs the code, and review its edit in the document and in `git diff`.',
    },
    {
      title: 'Legal',
      body: 'Drafting and negotiation, with each proposed change marked with who made it.',
    },
    {
      title: 'Pharma and healthcare',
      body: 'SOPs, policies and other controlled documents, reviewed change by change.',
    },
    {
      title: 'Research',
      body: 'Manuscripts and analyses in R Markdown and Quarto, reviewed the way prose is, without leaving the source format. File › Export to Word writes the `.docx` for journals.',
    },
  ],
};

export const developers = {
  title: 'For developers',
  cards: [
    {
      title: 'Plain Markdown files',
      body: 'Pending changes and comments are stored in the file. GitHub, VS Code, pandoc and Quarto show the newest text and hide the markup. No sidecar files, no backend.',
    },
    {
      title: 'Made for git',
      body: `Tracked changes merge with git, and \`git diff\` shows them. When ${possessive} own data conflicts, keeping both sides resolves it, by hand or by an agent.`,
    },
    {
      title: 'What you see is in the file',
      body: 'What stays on screen in the document is in the `.md`, for everyone who opens it. The one exception is an agent’s live status line.',
    },
    {
      title: 'Agents, with limits',
      body: 'Claude Code, Codex and OpenClaw agents get a small set of tools. They read only after you say yes, and reach the web only if you turn on one switch. They write only this document, as tracked changes. A mention that arrives through git never starts a run.',
    },
    {
      title: 'Built to embed',
      body: 'The format and the editor are TypeScript packages, in the repo, not yet on npm. The demos on this page are the editor itself, embedded in a static page with no server; a drop-in component for React comes later.',
    },
    {
      title: 'An open format',
      body: 'A documented file format, and MIT-licensed tools that read and write it: a TypeScript library in the repo, not yet on npm, and the `redlines` command line inside the app, for agents in a terminal.',
    },
  ],
};

export const closing = {
  title: 'The format is open. The app is free.',
  body: 'Open a design doc in a repo and ask @Claude or @Codex about it in a comment. The format, the code and the research behind them are on GitHub, MIT-licensed.',
  format: 'Read the format',
  designSpec: 'Read the design spec',
};

export const download = {
  title: 'Download',
  comingSoon: 'Coming soon',
  comingSoonBody: `${name} for Mac is on its way. Windows and Linux come later.`,
  /** After the version and date, once there is a release. */
  released:
    'It updates itself. To ask an agent, you need Claude Code or Codex signed in on your Mac, or an OpenClaw agent to connect to. Windows and Linux come later.',
  follow: 'Follow development on GitHub',
};

export const footer = {
  license: 'MIT license',
  github: 'GitHub',
  /** Until there is a release; then the footer shows the version. */
  preview: 'November 2026 · preview',
  released: (version: string) => `Version ${version}`,
};
