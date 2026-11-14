# AI providers and sign-in

Status: research notes, October 2026, with the findings of November 5, 2026 added
[below](#november-5-2026-what-the-first-build-found).

Redlines is open source and has no backend, so it uses the AI subscriptions people already have.
This study looks at how the editor can support Claude and OpenAI models, and possibly others, with
people signing in through those subscriptions instead of pasting API keys. The starting candidates
were OpenAI's own sign-in and Claude Code's headless mode (`claude -p`). As background on how AI
features are paid for, the study also records how Notion bundles AI and which outside AI accounts
Notion users can connect.

## Method

- **Sources:** vendor documentation, legal pages, help centers and changelogs, fetched on
  2026-10-14. Most of these pages carry no date, so they are cited as fetched that day.
- **Checked twice:** the claims the recommendation rests on were re-checked against the vendors'
  own pages.
- **Not legal advice.** These terms changed several times in 2026, so check them again before
  release.

## Claude

- A product may run the user's own Claude Code. Anthropic's legal page allows running the
  unmodified Claude Code program, with each user signing in with their own Claude subscription, API
  key or cloud credentials. The conditions:
  - the publisher agrees to Anthropic's Commercial Terms;
  - no built-in sign-in method is removed, disabled or restricted;
  - the product never pays for, resells or brokers anyone's Claude usage;
  - it never collects, stores or handles Claude credentials or tokens; sign-in happens in
    Anthropic's own flow;
  - "Claude Code" may not appear in the product's or a feature's name. Plain text may say a product
    "runs Claude Code," and Anthropic suggests labels such as "Claude Agent."
- One page still conflicts. The Agent SDK overview says third-party developers may not offer
  claude.ai login without Anthropic's approval. The two pages haven't been reconciled.
- **2026 timeline:**
  - 2026-01-09: Anthropic blocked tools that reused Claude Code's tokens;
  - 2026-02-18: a strict ban appeared in the docs and was softened the same day;
  - about 2026-08-22: the legal page's clause on products running Claude Code;
  - 2026-10-07: Max and Team plans gained monthly API credits (Max: $100–$200), a fully sanctioned
    API-key route for those subscribers. Pro is not eligible.
- `claude -p`, the headless mode, has two risks:
  - its `--bare` mode, which ignores subscription logins, "will become the default for `-p`";
  - without `--bare`, it runs a folder's own hooks and MCP servers with no trust prompt, a real
    risk for an editor that opens shared folders.

  Users sign in with `claude auth login`, because `/login` doesn't work in `-p`. Redlines should
  always pass a permission mode explicitly.

- **Streaming:** `--output-format stream-json --include-partial-messages` streams a tool call's
  input as it is written, so agent edits can be animated live.

## OpenAI

- Sign in with ChatGPT has been official since DevDay, 2026-09-29.
  - Open-source and locally hosted apps may use it without approval; paid or hosted apps go
    through an interest form.
  - It is a standard browser sign-in with a local redirect. Requests go to the Responses API on
    the user's plan, which streams tool arguments.
  - Plus and Pro are covered; Business and Enterprise reportedly are not (to confirm).
  - OpenAI's sample code has a noncommercial license, so Redlines implements the flow from the
    documentation instead.
- Codex app-server is still experimental. Local and open-source apps may keep using Codex's own
  ChatGPT login, but OpenAI recommends Sign in with ChatGPT, and "app-server authentication has
  never been permitted for commercial or hosted services." It delivers tool-call arguments only
  when complete, so edits can't be animated live. `codex mcp-server` was removed on 2026-09-05.

## Other routes

- **Agent Client Protocol (ACP):** used by Zed and JetBrains; version 1 is stable. About 42
  agents are listed, Claude Code and Codex through adapters, Gemini CLI, GitHub Copilot CLI and
  others directly. Agents run as local processes and handle their own sign-in, and the client can
  hand them its MCP server. ACP doesn't stream an edit's content, and the Claude and Codex
  adapters don't use its file-write hook, so edits must go through Redlines' MCP tools.
  Libraries exist for Rust and TypeScript.
- **GitHub Copilot SDK** (generally available 2026-06-02): usage is billed to each user's own
  Copilot subscription, with a sign-in mode for desktop apps, and it offers Claude, GPT and Gemini
  models. It is the clearest sanctioned route to several models on one subscription.
- **Gemini CLI** stopped serving personal and Google AI Pro/Ultra accounts on 2026-06-18, and
  Google forbids other software from reusing its sign-in. Only API keys and company licenses
  remain.
- **Local models:** Ollama, LM Studio and llama.cpp expose OpenAI- and Anthropic-compatible
  endpoints. OpenRouter offers a "connect your account" sign-in for desktop apps.

## November 5, 2026: what the first build found

Redlines v0.2 runs Claude and Codex through their own programs. A throwaway build on macOS 27.0.1
(arm64), with Claude Code 2.1.318 and Codex 0.166.0, tested the lines it would use against the real
programs. These notes add to the October ones above, and where they differ, these are newer. The
vendors' terms and pages were read again on Nov 5. They changed several times this year, so read
them again before a release.

### The route is the program's own

Claude Code and Codex already are agent loops, with the tools, the sign-in and the model choice. A
provider in Redlines starts the program in the document's folder, hands it Redlines' six tools
over MCP, and turns its JSON Lines into status lines. Redlines holds no tokens and runs no loop of
its own.

- **Claude, subscriptions need `claude`.** Anthropic doesn't let third-party developers offer
  Claude.ai login or route requests through plan credentials. Its legal page says this doesn't
  "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude
  subscription". A product that runs Claude Code has to agree to the Commercial Terms, must not
  modify it or resell usage, and may not use the name in a product or feature name.
- **Claude, it still draws on the plan.** The separate credit pool announced for June 15 was
  paused. As of the Oct 7 update, `claude -p` signed in with a plan still draws from subscription
  limits. The monthly API credits (Max $100, Ultra $200, Team per seat; not Pro) only cover runs
  with an API key.
- **Claude, the biggest outside risk is `--bare`.** Anthropic says it "will become the default for
  `-p`", and bare mode never reads OAuth credentials. If that flips with no opt-out, plan runs
  stop working. Redlines checks the sign-in before a run, with `claude auth status`, and fails
  with a clear line instead of silently.
- **ChatGPT is not the same as Claude.** Running Codex is allowed: `codex exec` reuses Codex's
  saved login by default. On app-server login OpenAI says "If you've built a local or open-source
  application using Codex app-server authentication, you can continue using it", recommends
  moving to Sign in with ChatGPT, and says it "has never been permitted for commercial or hosted
  services". So if Redlines ever became a paid or hosted product, this route would have to
  change. Codex's docs call API keys "the recommended default for automation", but a plan
  sign-in is what people have.
- **Codex needs no Node.** `brew install --cask codex` and OpenAI's standalone installer both work.

### What the real programs do

- **Folder code.** With Claude's `--restricted` and `--settings '{"disableAllHooks":true}'`, a
  repo's `.mcp.json` and hooks didn't run, and with neither flag they did (a positive control with
  marker files). With Codex's `--ignore-user-config --ignore-rules`, a repo's `.codex` ran nothing.
  The question Redlines asks is about consent, then, and not about code in the folder.
- **Reads can be limited to the folder, in both.** Claude's `--restricted` confines Read, Grep and
  Glob to the working folder, symlinks included, whatever the person's own settings say. The plan's
  first choice, `--setting-sources user`, doesn't: a bare `Read` in `~/.claude/settings.json`, or
  `additionalDirectories`, widened it. For Codex, `--sandbox read-only` blocks writes but reads
  anywhere. A permission profile (`default_permissions` and `permissions.<name>.filesystem`) made
  macOS refuse each read outside the folder, for the shell, `view_image` and a helper agent alike,
  and tests of it need no model (`codex sandbox`). Don't pass both.
- **Codex handed the model the person's ChatGPT connectors.** Under the first flags it had tools
  such as `mcp__codex_apps__github_create_commit` and `github_delete_file`, and a web tool. They
  come from the account, not from a config on the Mac, so `--ignore-user-config` doesn't remove
  them. `--disable apps` and the other `--disable` flags of the line do, and cut the prompt too,
  from 12,484 input tokens to 7,518 for a one-word answer. Codex adds to its defaults without
  warning, so a test names these flags.
- **Codex's toolbox calls need approval,** unless `default_tools_approval_mode="approve"` is set.
  Without it every call failed with "MCP tool call requires approval, but approval policy is
  never".
- **A toolbox that can't start doesn't fail the run.** Both agents carry on without it and exit 0.
  Redlines counts a run as failed when its relay never saw `initialize`, or Claude's `system/init`
  says the server isn't connected.
- **Sign-in checks.** `claude auth status` prints JSON and exits 1 when signed out, and a stale
  token counts as signed out. `codex login status` prints "Logged in using ChatGPT" and exits 0,
  or "Not logged in" and exits 1. `system/init`'s `apiKeySource` is `"none"` both for a good plan
  sign-in and for none, so it can't be the check.
- **The agent's environment.** Started from inside a Claude Code session, the app inherits
  `CLAUDE_CODE_SIMPLE=1` (what `--bare` sets, with no plan sign-in), `ANTHROPIC_BASE_URL` and about
  thirty other variables. A provider removes `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`
  and `ANTHROPIC_BASE_URL`.
- **Streams.** Claude's events include types no one planned for, so the parser ignores what it
  doesn't know. A failed Claude run ends with `subtype: "success"` and `is_error: true`. Codex has
  no result line: a run ends with `turn.completed` and exit 0, or `turn.failed` and exit 1, and its
  last `agent_message` can be empty after a good `reply`. Most of Codex's shell commands make no
  event, so fallback status lines come from tool calls and messages, and otherwise "Thinking…".
- **The two clients speak MCP differently.** Claude asks `server/discover` first with a string id
  and takes `-32601` as "use the old way"; Codex goes straight to `initialize`. The server answers
  with the version it was asked for, ignores `_meta`, and echoes ids of either type.
- **A tool call lands in the live editor in 0 to 13 ms.** A real typed transaction during a run
  and the agent's edit both survived. With a scripted model, a run from comment to reply took
  about 0.4 s; with Codex's default model, 11.1 s to the reply and 14.0 s to the end of the
  program, and its status line first changed at 7 to 16 s, so Redlines shows its own "Thinking…"
  before that.

### What isn't proved

On the Mac where this was tested, Claude's sign-in had expired (`claude auth status` said
`loggedIn: false`), so every Claude result above is from the real 2.1.318 program against a
stand-in for the Messages API. Not yet shown with a real plan sign-in: that `--restricted` and
`--setting-sources user` keep it, how a real model's stream looks, and how long a real Claude run
takes. `--restricted` ignores all of the person's settings, including a `model`, an
`apiKeyHelper` or `env` there, so someone who signs in only through an `apiKeyHelper` won't be
signed in. If `--restricted` loses the plan sign-in, the fallback is `--setting-sources user`,
with reads then held only while the person's own settings don't widen them.

### Routes looked at and not used

- **Agent Client Protocol (ACP)** is the standard used by Zed and JetBrains, with about 49 agents
  listed. It is right for the long tail, such as OpenClaw, Gemini CLI, GitHub Copilot, Cursor,
  OpenCode and Goose, and a new agent would be a line of configuration. Claude and Codex only
  reach it through adapters. `claude-agent-acp` is built on the Agent SDK, the one place Anthropic's
  docs say third parties may not offer claude.ai login, and it puts a layer between Redlines and
  the flags that keep a run safe. Anthropic's own docs name `claude -p` as the way to drive Claude
  from another language. So Claude and Codex run directly, and ACP is for the others, later.
- **oneharness** (one binary with a uniform JSON output for several agents, version 0.28) was the
  closest ready-made option. It would put one person's project in the critical path to save a few
  hundred lines, and the part of its docs that was read shows how to turn MCP off but not how to
  hand it a server.
- **harnesscli** is at 0.1.6, last published in February, from one owner.
- **The Claude Agent SDK and the Codex SDK** need Node or Python, and both drive the same
  programs anyway.

### Sources for Nov 5

- Anthropic: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
  [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview),
  [Run Claude Code programmatically](https://code.claude.com/docs/en/headless),
  [Permissions](https://code.claude.com/docs/en/permissions),
  [Use the Agent SDK with your plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan),
  [Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)
- OpenAI: [Codex app-server](https://learn.chatgpt.com/docs/app-server),
  [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
  [Authentication](https://learn.chatgpt.com/docs/auth),
  [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source),
  [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
  [Codex CLI install](https://developers.openai.com/codex/cli)
- Agent Client Protocol: [Agents](https://agentclientprotocol.com/overview/agents),
  [Registry](https://agentclientprotocol.com/registry/index),
  [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp),
  [codex-acp](https://github.com/agentclientprotocol/codex-acp),
  [OpenClaw ACP](https://docs.openclaw.ai/hi/tools/acp-agents)
- Other: [oneharness](https://pypi.org/project/oneharness-cli/),
  [harnesscli](https://docs.rs/crate/harnesscli/latest)
- The measurements are from the project's own spike findings, Nov 5, 2026, which are in
  [`docs/superpowers/plans/2026-11-05-v0.2-spike-findings.md`](../superpowers/plans/2026-11-05-v0.2-spike-findings.md).

## How Notion pays for AI and connects outside accounts

- AI is bundled and paid for by Notion. It has been part of the Business ($20 per seat) and
  Enterprise plans since 2025-05-13, with usage credits added in 2026. Models from OpenAI,
  Anthropic, Google and others sit behind a model picker.
- Users can't bring their own keys. Since about 2026-09-29, members of Business and Enterprise
  workspaces can connect a ChatGPT Plus, Pro or Go plan to Notion Agent, for GPT models only.
  Notion's help says an Anthropic account can't be used.

## Recommendation

The [design spec](../design.md) follows this recommendation in its section on agents and AI.

*Update, Nov 5, 2026:* v0.2 builds the Claude and OpenAI drivers below differently. Claude and Codex both
run as the person's own programs (`claude -p` and `codex exec`), and Sign in with ChatGPT inside
Redlines, with its own agent loop, is for later. See
[the Nov 5 findings](#november-5-2026-what-the-first-build-found).

1. An agent host in the desktop app with several drivers:
   - **Claude:** run the user's own Claude Code (`claude -p`, streaming), signed in through
     Claude Code itself. Redlines never touches tokens, and the feature is called "Claude Agent."
   - **OpenAI:** Sign in with ChatGPT, with Redlines' own agent loop on the Responses API.
     Optionally Codex app-server for folder chat.
   - **Other agents** through ACP: GitHub Copilot, Gemini (API key or company license), OpenCode,
     Goose and others.
   - **GitHub Copilot SDK** for several models on one subscription.
   - **Keys and local models:** API keys (including Max and Team API credits), AWS Bedrock,
     Google Vertex, Azure, OpenRouter, Ollama, LM Studio, llama.cpp.
2. Edits always go through Redlines' MCP tools, so they follow the agent's level (Propose, Suggest or
   Auto, as defined in the design spec). Agents' own file-editing tools are turned off, and
   Redlines compares the folder before and after each turn as a safety net.
3. **Animation:** live where tool input streams (Claude Code, the direct APIs, llama.cpp);
   elsewhere the finished edit is played back.
4. **Defaults:**
   - AI is off in a folder until someone turns it on.
   - Redlines asks before running an agent in a folder it hasn't trusted.
5. **Avoid:** reading or reusing anyone's sign-in tokens; a Redlines-branded Claude login;
   brokering anyone's usage; "Claude Code" in names; copying OpenAI's sample code; Codex's
   ChatGPT login in hosted or commercial settings.
6. Syrus runs agents on a server, so it uses API keys, cloud credentials or enterprise agreements;
   subscription sign-in doesn't apply there.

## Open questions for the vendors

- **Anthropic:** must an open-source publisher accept the Commercial Terms, and does the legal page
  supersede the Agent SDK's note? When will `--bare` become the default for `-p`?
- **OpenAI:** which plans are eligible for Sign in with ChatGPT, and how long do its tokens last?

## Sources

- Anthropic: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
  [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview),
  [headless mode](https://code.claude.com/docs/en/headless),
  [monthly API credits for Max and Team](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)
- OpenAI: [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source),
  [Codex app-server](https://learn.chatgpt.com/docs/app-server),
  [Sign in with ChatGPT in app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- GitHub: [Copilot SDK OAuth](https://raw.githubusercontent.com/github/copilot-sdk/main/docs/setup/github-oauth.md),
  [Copilot SDK authentication](https://raw.githubusercontent.com/github/copilot-sdk/main/docs/auth/authenticate.md)
- Google: [Gemini CLI consumer accounts](https://github.com/google-gemini/gemini-cli/discussions/28017)
- Notion: [ChatGPT plan with Notion Agent](https://www.notion.com/help/use-your-chatgpt-plan-with-notion-agent)

A longer version of these notes, with a dated source for every claim, is in the project's lab,
outside this repository.
