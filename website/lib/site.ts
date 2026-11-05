// The page's copy, in one place. The product name comes from site.config.mjs;
// keep it out of the strings below, so a rename stays a one-line change. The
// illustrations (the components that draw the editor) hold their own sample
// text. Text between backticks is set as code.

import { product } from '../site.config.mjs';

const { name } = product;

/** The name's possessive: "Redlines’", or "Plainsong’s" after a rename. */
const possessive = name.endsWith('s') ? `${name}’` : `${name}’s`;

/** The design spec, the format and the license, on GitHub. */
export const links = {
  designSpec: `${product.repository}/blob/main/docs/design.md`,
  format: `${product.repository}/blob/main/docs/format.md`,
  license: `${product.repository}/blob/main/LICENSE`,
};

const lede = `People and AI need a shared document format: a plain file that holds who changed what, that both can read, edit and review. ${name} is a free, open-source Markdown editor for Mac, built on one. Ask @Claude or @Codex in a comment, and its reply and tracked edit land in the file.`;

export const meta = {
  title: `${name}: a Markdown editor that shows every change, for people and AI`,
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
  title: 'One file for people and AI.',
  titleAccent: 'See every change.',
  lede,
  designSpec: 'Read the design spec',
  download: 'Download',
  github: 'View on GitHub',
  /** Under the buttons until there is a full release. */
  unreleased: 'The first full release is on its way. The design and the format are on GitHub.',
  /** Under the buttons once there is one: "Version 1.0 for macOS". */
  released: (version: string, platforms: string) => `Version ${version} for ${platforms}`,
};

export const aiDocs = {
  title: 'Markdown is the document format of AI.',
  body: 'Plans, specs and reports from agents arrive as `.md` files. But Markdown has no place for a tracked change or a comment, and Word and Google Docs, which do, aren’t where agents work. So review moves to a chat, and the file never records who changed what.',
  points: [
    'Open any `.md` file and read it formatted, with tables, images, task lists and syntax-colored code.',
    'Edit it like a document: bold from the keyboard, find and replace, a file sidebar.',
    'It stays a plain file that agents, git and other Markdown tools read as usual.',
  ],
};

export const changes = {
  title: 'Every change is in the file.',
  body: `${name} adds what Markdown lacks, in the plain file: each tracked change and comment, with who made it and when. You and your agents edit the same text, and you accept or reject each change, like Track Changes in Word or Suggesting in Google Docs.`,
  /** The button that plays and pauses the agent illustration. */
  play: 'Play the animation',
  pause: 'Pause the animation',
  points: [
    'Mention @Claude or @Codex in a comment. A status line shows what it’s doing while you keep typing.',
    'It replies in a few words, citing the file and line it read. A click opens that file.',
    'Its edits are always tracked changes, in its own name. Accepting and rejecting stay with you.',
    `${name} runs the Claude Code and Codex on your Mac, signed in as you, and never touches your credentials.`,
  ],
};

/** Whether each product has a feature, in the order of `compare.products`. */
type Support = readonly [boolean, boolean, boolean, boolean, boolean];

export const compare = {
  title: `How ${name} compares`,
  body: `${name} today. Other products as of October 2026, from their documentation. VS Code includes the Live Share, GitHub Copilot and Quarto extensions.`,
  /** Under the table. */
  note: `Live collaboration with AI means an agent that works in the document as itself. In Word and Google Docs, the AI edits only when asked, and its edits count as yours. ${name} has no server, so people share the file as they share any file. Word import and export come next.`,
  /** The table's scrolling box and the features column, named for screen readers only. */
  table: 'Comparison table',
  feature: 'Feature',
  yes: 'Yes',
  no: 'No',
  products: [name, 'Word', 'Google Docs', 'Notion', 'VS Code'],
  rows: [
    { feature: 'Edits Markdown files', support: [true, false, true, false, true] },
    { feature: 'R Markdown and Quarto', support: [true, false, false, false, true] },
    { feature: 'Tracked changes (suggestions)', support: [true, true, true, true, false] },
    { feature: 'Comment threads', support: [true, true, true, true, false] },
    {
      feature: 'Tracked changes stored in the Markdown file',
      support: [true, false, false, false, false],
    },
    { feature: 'Changes and comments merge in git', support: [true, false, false, false, false] },
    { feature: 'Live collaboration with people', support: [false, true, true, true, true] },
    { feature: 'Live collaboration with AI', support: [true, false, false, true, true] },
    {
      feature: 'AI agents suggest changes in their own name',
      support: [true, false, false, false, false],
    },
    {
      feature: 'Word files with tracked changes, in and out',
      support: [false, true, true, false, false],
    },
    { feature: 'Free and open source', support: [true, false, false, false, true] },
  ] satisfies { feature: string; support: Support }[],
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
      body: 'Drafting and negotiation, where every change must be visible and attributable.',
    },
    {
      title: 'Pharma and healthcare',
      body: 'SOPs, policies and other controlled documents, reviewed change by change, with the record in the file.',
    },
    {
      title: 'Research',
      body: 'Manuscripts and analyses in R Markdown and Quarto, reviewed the way prose is, without leaving the source format. Word export for journals comes next.',
    },
  ],
};

export const developers = {
  title: 'For developers',
  cards: [
    {
      title: 'Plain Markdown files',
      body: 'Changes and comments are stored in the file. GitHub, VS Code, pandoc and Quarto show the latest version and hide the markup. No sidecar files, no backend.',
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
      body: 'Claude Code and Codex get a small set of tools. They read only after you say yes and write only this document, as tracked changes. A mention that arrives through git never starts a run.',
    },
    {
      title: 'Built to embed',
      body: 'The format and the editor are TypeScript packages with no tie to the desktop app, and a test holds them to it. A drop-in component comes later.',
    },
    {
      title: 'An open format',
      body: 'A documented file format, and MIT-licensed tools that read and write it: a TypeScript library, and the `redlines` command line inside the app, for agents in a terminal.',
    },
  ],
};

export const closing = {
  title: 'The format is open. The app is free.',
  body: 'Open a design doc in a repo and ask @Claude or @Codex about it in a comment. The format, the code and the research behind them are on GitHub, MIT-licensed. Word import and export come next, and Windows and Linux later.',
  format: 'Read the format',
  designSpec: 'Read the design spec',
};

export const download = {
  title: 'Download',
  comingSoon: 'Coming soon',
  comingSoonBody: `${name} for Mac is on its way. Windows and Linux come later.`,
  /** After the version and date, once there is a release. */
  released:
    'It updates itself. To ask an agent, you need Claude Code or Codex signed in on your Mac. Windows and Linux come later.',
  follow: 'Follow development on GitHub',
};

export const footer = {
  license: 'MIT license',
  github: 'GitHub',
  /** Until there is a release; then the footer shows the version. */
  preview: 'November 2026 · preview',
  released: (version: string) => `Version ${version}`,
};
