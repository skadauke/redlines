# AI providers and sign-in

Status: research notes, October 2026.

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

## How Notion pays for AI and connects outside accounts

- AI is bundled and paid for by Notion. It has been part of the Business ($20 per seat) and
  Enterprise plans since 2025-05-13, with usage credits added in 2026. Models from OpenAI,
  Anthropic, Google and others sit behind a model picker.
- Users can't bring their own keys. Since about 2026-09-29, members of Business and Enterprise
  workspaces can connect a ChatGPT Plus, Pro or Go plan to Notion Agent, for GPT models only.
  Notion's help says an Anthropic account can't be used.

## Recommendation

The [design spec](../design.md) follows this recommendation in its section on agents and AI.

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
2. Edits always go through Redlines' MCP tools, so they follow the agent's level (Ask, Suggest or
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
