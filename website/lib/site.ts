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

const lede = `${name} is a free, open-source Markdown editor for Mac, Windows and Linux. It opens what you and your AI tools write as beautifully rendered documents, and shows every change, yours, your colleagues’ and your AI’s, for you to accept or reject.`;

export const meta = {
  title: `${name}: a beautiful Markdown editor that shows every change`,
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
  title: 'Markdown, beautifully.',
  titleAccent: 'See every change.',
  lede,
  designSpec: 'Read the design spec',
  download: 'Download',
  github: 'View on GitHub',
  /** Under the buttons until there is a release. */
  unreleased: 'Not released yet. The design and the format are open for feedback on GitHub.',
  /** Under the buttons once there is one: "Version 1.0 for macOS, Windows and Linux". */
  released: (version: string, platforms: string) => `Version ${version} for ${platforms}`,
};

export const aiDocs = {
  title: 'Markdown is the document format of AI.',
  body: `Answers from ChatGPT and Claude, plans and reports from agents, READMEs and specs all arrive as \`.md\` files, and most apps show them as code. ${name} shows you a beautifully rendered document.`,
  points: [
    'Open any `.md` file and read it formatted, with tables, math and diagrams.',
    'Paste from web pages, Word or Google Docs and get clean Markdown.',
    'Copy into Word or Google Docs and keep the headings, tables and fonts.',
  ],
};

export const changes = {
  title: 'See every change.',
  body: 'When a colleague or an AI edits your document, each change shows who made it and when, and you accept or reject it, like Track Changes in Word or Suggesting in Google Docs. It is all saved in the plain Markdown file.',
  /** The button that plays and pauses the agent illustration. */
  play: 'Play the animation',
  pause: 'Pause the animation',
  points: [
    'Accept or reject one change, everything from one person, or all at once.',
    'Comment threads in the margin, with replies and @mentions.',
    'AI agents suggest edits in their own name, or edit directly if you prefer, with a record you can undo.',
    'Use the Claude or ChatGPT account you already have, your own API keys, or a local model.',
  ],
};

/** Whether each product has a feature, in the order of `compare.products`. */
type Support = readonly [boolean, boolean, boolean, boolean, boolean];

export const compare = {
  title: `How ${name} compares`,
  body: `${name} as designed. Other products as of October 2026, from their documentation. VS Code includes the Live Share, GitHub Copilot and Quarto extensions.`,
  /** Under the table. */
  note: 'Live collaboration with AI means an agent that works in the document as itself. In Word and Google Docs, the AI edits only when asked, and its edits count as yours.',
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
    { feature: 'Accept or reject by person', support: [true, true, false, false, false] },
    {
      feature: 'Tracked changes stored in the Markdown file',
      support: [true, false, false, false, false],
    },
    { feature: 'Changes and comments merge in git', support: [true, false, false, false, false] },
    {
      feature: 'Full edit history, stored in the file',
      support: [true, false, false, false, false],
    },
    { feature: 'Live collaboration with people', support: [true, true, true, true, true] },
    { feature: 'Live collaboration with AI', support: [true, false, false, true, true] },
    {
      feature: 'AI agents suggest changes in their own name',
      support: [true, false, false, false, false],
    },
    {
      feature: 'Word files with tracked changes, in and out',
      support: [true, true, true, false, false],
    },
    {
      feature: 'Desktop app for Mac, Windows and Linux',
      support: [true, false, false, false, true],
    },
    { feature: 'Embeddable editor component', support: [true, false, false, false, true] },
    { feature: 'Free and open source', support: [true, false, false, false, true] },
  ] satisfies { feature: string; support: Support }[],
};

export const uses = {
  title: 'Wherever documents get reviewed',
  body: `Tracked changes and comments are how contracts, regulated documents and papers get written. ${name} keeps them in plain Markdown, which every tool can read.`,
  cards: [
    {
      title: 'Legal',
      body: 'Drafting and negotiation, where every change must be visible and attributable, and the full history of a negotiation can be replayed.',
    },
    {
      title: 'Pharma and healthcare',
      body: 'SOPs, policies and other controlled documents, with review and approval cycles.',
    },
    {
      title: 'Academia',
      body: 'Scientific manuscripts and responses to reviewers, co-authored with figures, captions, citations and cross-references, and usually sent to the journal as a Word file.',
    },
    {
      title: 'Data science',
      body: 'R Markdown and Quarto documents, reviewed the way prose is, without leaving the source format.',
    },
  ],
};

export const developers = {
  title: 'For developers',
  cards: [
    {
      title: 'Plain Markdown files',
      body: 'Changes and comments are stored in the file. GitHub, VS Code, pandoc and Quarto show the latest version and hide the markup.',
    },
    {
      title: 'Made for git',
      body: `Tracked changes merge with git. When ${possessive} own data conflicts, keeping both sides always resolves it, by hand, by an AI or automatically.`,
    },
    {
      title: 'Full history, if you want it',
      body: 'Keep only the current version, or every edit, so any earlier version can be replayed. No sidecar files, no backend.',
    },
    {
      title: 'Agents through MCP',
      body: `Claude, Codex and other agents edit through ${possessive} tools, so their work arrives as reviewable changes.`,
    },
    {
      title: 'A component for your app',
      body: 'The editor, with tracked changes and comments, as a React component that takes on your app’s look.',
    },
    {
      title: 'An open format',
      body: 'A documented file format, and MIT-licensed tools that read and write it: a TypeScript library, a command line and an MCP server.',
    },
  ],
};

export const closing = {
  title: `${name} is being designed in the open.`,
  body: 'The design spec, the file format and the research behind them are on GitHub. Feedback on the idea, the format or the features is welcome.',
  designSpec: 'Read the design spec',
  format: 'Read the format',
};

export const download = {
  title: 'Download',
  comingSoon: 'Coming soon',
  comingSoonBody: `${name} isn’t released yet. It will be available for macOS, Windows and Linux.`,
  follow: 'Follow development on GitHub',
};

export const footer = {
  license: 'MIT license',
  github: 'GitHub',
  /** Until there is a release; then the footer shows the version. */
  preview: 'October 2026 · design preview',
  released: (version: string) => `Version ${version}`,
};
