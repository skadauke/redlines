# Claude, Codex and ChatGPT

Status: research notes, October 2026.

Many people now read Markdown in AI chat apps and coding agents. This study looks at how Claude,
Codex and ChatGPT render Markdown and Redlines files, and how Redlines can be integrated into
Claude and Codex, as is planned for Syrus, an open-source software factory that will get a
Redlines plugin ([design spec](../design.md)).

## Method

- **Sources:**
  - official docs and changelogs from Anthropic and OpenAI;
  - issues in `anthropics/claude-code` and `openai/codex`;
  - the Codex CLI's source code, which is open source. Its Markdown renderer was read at commit
    `76ed3b48`.
- **What was run:**
  - a Markdown test card with 13 probes, rendered through GitHub's API as the reference;
  - four common web-chat Markdown setups, emulated locally.
- **What wasn't done:** no chat messages were sent and no account was used. Where no source exists
  the answer is marked unknown; the test card settles it in one message per product.
- **Evidence labels:** "documented," "source" (read in open-source code), "reported" (an issue or
  forum post) and "inferred."

The code and data are in the project's lab, outside this repository. They include the test card
with its checklist, and a full report with the details and sources behind each claim below.

## Four ways a chat app can treat a Redlines file

| Kind of renderer    | What a reader sees                                                                                    | Where                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Shows HTML as text  | Every marker, the deleted text and the ledger, as literal `<!--…-->`. Old and new wording both appear | **Codex CLI** (source). ChatGPT showed HTML tags as text in 2025 (reported)              |
| Drops raw HTML      | Only the newest text. `<br>`, `<details>` and `<img>` vanish too, so words run together               | None confirmed                                                                           |
| Sanitizes HTML      | Only the newest text; comments removed; allowed tags render                                           | **GitHub** (verified); probably the Claude desktop app's Code tab (inferred from issues) |
| Passes HTML through | The newest text on screen, but deleted text and the ledger stay in the page source                    | VS Code's preview ([tools](tools.md))                                                    |

No public source says what claude.ai or ChatGPT do with an HTML comment. The test card answers
that.

What is known per product (details and sources are in the full report):

- **Claude:**
  - **claude.ai** renders tables, Mermaid and math in `$` and `$$` (reported).
  - **The desktop app's Code tab** sanitizes HTML (reported), and footnotes show as plain text.
  - **The Claude Code CLI** renders tables, task lists and strikethrough in the terminal
    (documented).
  - **Markdown artifacts** render as document pages (documented).
- **OpenAI:**
  - **The Codex CLI** prints raw HTML and HTML comments verbatim, ignores footnotes, and draws
    math and Mermaid in the terminal (source).
  - **ChatGPT** renders tables, and Mermaid through a preview button (documented). Its desktop
    preview shows `<br>` literally (reported).
- Long pastes become attachments in claude.ai, ChatGPT and Codex. The model gets the raw text,
  sometimes empty in claude.ai (reported).

## What a Redlines file looks like there

Three rules hold everywhere:

1. The model sees the raw file whenever it reads one, through file tools, `cat` or an attachment.
   The one exception: Claude Code strips comments from an automatically loaded CLAUDE.md, so
   Claude would see only the newest text there.
2. The only predictable way to show Redlines changes in a chat is a code fence, best with the
   CriticMarkup review view inside it.
3. The worst case is a chat that hides comments while a model "returns the edited document." The
   reader sees clean text with no sign that anything was deleted. So Redlines files should move
   through files and tools, never through chat text.

## Integration

One core with several wrappers, as in the agent interface of the [design spec](../design.md):

- `@redlines/format` holds the operations as pure functions;
- a `redlines` command line exposes them, including `review` (the CriticMarkup
  [view](../format.md#8-views)) and `track` (turn outside edits into tracked changes);
- `@redlines/mcp` exposes them as MCP tools.

Everything below is packaging around these three.

The tools follow the agent grammar in the design spec. They are separate tools with the parameter
names of Claude's text editor tool, so each host can gate them separately:

- `view` is read-only.
- `str_replace`, `insert`, `create` and `batch` write suggestions.
- The comment tools let agents edit only their own comments.
- `accept` and `reject` are marked destructive: Codex always asks first, and Claude Code gates
  them through permission rules.
- Agent handles such as `claude-ada` or `codex-ada` come from the MCP client's name plus the user.

**For Claude:**

| Option                                                                                                                    | Reaches                                                                                               | Notes                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local MCP server** (`.mcp.json` committed to the repo)                                                                  | Claude Code everywhere (terminal, desktop, VS Code, cloud sessions), Claude Desktop                   | The first thing to build. Claude Code's "channels" let the server push events, which gives live `@claude` mentions                                                                                                                                                  |
| **A skill** (`SKILL.md`)                                                                                                  | Every surface: claude.ai, Claude Code, the API, the Agent SDK. Codex and ChatGPT load the same format | Teaches the rules: never type markers, never rewrite a Redlines file whole, read the review view, show changes in chat as CriticMarkup in a fence                                                                                                                   |
| **A Claude Code plugin** (MCP server + skill + hooks + a reviewer subagent + commands), with its marketplace in this repo | Claude Code; skills and remote MCP reach claude.ai                                                    | **Hooks:** a guard that blocks raw edits to markers and points to the Redlines tools; a track hook that turns Claude's ordinary Edit into tracked changes. A spike should test a "transparent" mode, in which Claude edits the newest text with its usual Edit tool |
| **A remote MCP server** as a claude.ai connector, with an MCP Apps review UI                                              | claude.ai on web, desktop and mobile; also ChatGPT and VS Code Copilot                                | Solves the chat display problem: tracked changes drawn as in Word inside the conversation, with Accept and Reject. Needs OAuth and a backend, in practice a GitHub App (Syrus's backend minus its UI)                                                               |
| **The API's text editor tool**, implemented on a server against the newest text                                           | Syrus's mention agent, a review bot, the editor's agent panel                                         | Claude edits Redlines documents with the tool it is trained on                                                                                                                                                                                                      |
| **An artifact** hosting the editor                                                                                        | claude.ai                                                                                             | Artifacts can keep shared state and take viewer comments, so a demo is possible. Not the product: no git, and size limits                                                                                                                                           |

**For Codex and ChatGPT:**

- The same local MCP server, configured in `.codex/config.toml`; it covers the Codex CLI, the IDE
  extension and the desktop app.
- `AGENTS.md`, which Claude Code also reads when there is no CLAUDE.md.
- The same skill file, under `.agents/skills/`.
- The same plugin folder: OpenAI's portal converts Claude plugin manifests.
- Codex hooks are like Claude's and can intercept its `apply_patch` edits for tracking. GPT models
  are trained on `apply_patch`, not `str_replace`, so tracking their ordinary edits matters more
  there.
- Codex cloud opens pull requests, where GitHub's merge button never runs the Redlines merge
  driver (`redlines merge-driver`). A GitHub Action that posts the CriticMarkup review view of
  changed Redlines files helps every agent's pull requests.
- **ChatGPT:**
  - a plugin can bundle skills, MCP and the same MCP Apps review UI;
  - the desktop app lets a plugin claim a file type, which is the closest thing to native Redlines
    support there.

## Recommendation

| Order | Build                                                                                                                     | Effort (estimate; assumes `packages/format` exists) |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1     | The `redlines` command line and a local MCP server, as one package                                                        | 1.5–2.5 weeks                                       |
| 1     | The skill and an `AGENTS.md` snippet, shipped on their own at the same time                                               | 3–5 days                                            |
| 2     | The Claude Code plugin: MCP, skill, guard and track hooks, a reviewer subagent; check that Codex installs the same folder | 1–1.5 weeks                                         |
| 2     | A GitHub Action that posts the review view on pull requests                                                               | 3–5 days                                            |
| 3     | A remote MCP server with OAuth and a GitHub App backend                                                                   | 3–5 weeks                                           |
| 3     | The MCP Apps review UI, once the editor core exists                                                                       | 2–3 weeks                                           |
| Later | A ChatGPT plugin with a file viewer, the transparent-edit spike, an artifact demo                                         | 1–2 weeks each                                      |

This matches the plan for the Syrus plugin: the same operations and grammar. The differences are
storage (files or a GitHub App instead of Syrus's git authority) and how agents are woken up
(channels or a remote server instead of Syrus's live session).

## Risks

- **Prompt injection through hidden text.** Deleted text and comment threads are invisible on
  GitHub but fully visible to agents, and that is where 2025–2026 attacks on coding agents hid
  their instructions. Mitigations:
  - Agents only suggest.
  - Accepting, rejecting and resolving need a human.
  - Tool results label each piece of text with its author, as untrusted.
  - Agents act on mentions only from known collaborators.
  - A `redlines lint` flags invisible characters and instruction-like payloads.
- **The display problem.** Chat apps differ: some hide deletions from a reader, some show raw
  markers. Rich-text message boxes may also rewrite pasted Markdown. Files and tools are the safe
  path.
- **Sandboxing.** MCP servers and hooks run outside the sandbox in both Claude Code and Codex, so
  the server must confine writes to the workspace.
- **Moving targets.** The hook and plugin interfaces are new and changing quickly.
- **Naming.** `md-redline` (MIT, since March 2026), a separate project, stores review comments as
  HTML comments and has an MCP server. It has comments only, no tracked changes. Its name is close
  to "Redlines."

## Still to do

- Render the test card in claude.ai, the Claude desktop app, ChatGPT and the Codex CLI, and record
  what each shows, using the card's checklist.
