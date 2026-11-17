# Connecting other agents

Status: research note, November 16, 2026. Nothing here is built; it is the input to the next Epic.

> **Revision, November 16, 2026: Stephan's decision.** For OpenClaw, build a **native adapter**,
> **OpenClaw first, over Tailscale**: "that's what openclaw already does". The recommendation
> below (a Redlines MCP endpoint on a loopback port, and a tunnel the person runs) is **superseded
> for OpenClaw** by [openclaw-connection.md](openclaw-connection.md). There, Redlines is an OpenClaw
> _node_: it connects **out** to the Gateway, over Tailscale, and publishes its six tools, which
> the Gateway routes back to it. That needs no inbound port on the Mac and no tunnel to it, and
> setup is one prompt for the person's agent plus a setup code. The proximate goal is a polished
> setup for a Gateway on another computer. This note's findings stand: MCP is the common floor,
> the two directions (tools in, jobs out), isolation of a mention, secrets as files, and the
> comparison of the protocols. The loopback endpoint (option 2b) stays as the way to connect the
> agents that are not OpenClaw (Hermes, Grok Build and the rest), and a Mac that can't use
> Tailscale; it is no longer the first thing to build.

Redlines runs Claude Code and Codex through their own programs, and reaches OpenClaw agents through
`openclaw acp` ([design §8.6](../design.md#86-ai-engines-and-sign-in),
[ai-providers.md](ai-providers.md)). People also run other agents: OpenClaw, Hermes, Grok-based
bots, Muse-style personal agents, and whatever comes next, often on a machine other than the one
Redlines is on. This note asks how all of them should connect, as one journey, without a provider
written for each.

## Summary

- **The one thing every agent has in common is MCP, not ACP.** Every agent looked at here can be
  given an MCP server (Claude Code, Codex, OpenClaw, Hermes, Grok Build, and Muse's connector
  platform). Only some speak ACP, and OpenClaw's ACP bridge refuses the tools Redlines would hand
  it. The six tools already exist as an MCP server (`packages/agent-tools`).
- **The missing piece is a standing, authenticated way in.** Today the toolbox is a private
  socket made for one run that Redlines itself started (`redlines mcp --relay`). An agent that
  someone else started, on this Mac or another, has nothing to connect to. The shell route
  (`redlines` and the skill) works on one Mac but cannot enforce anything: the agent writes the file
  itself, names itself with `--as`, and has no grant to revoke.
- **Recommendation: Connections.** One thing in Preferences › Agents, a _connection_: a handle,
  the folders it may touch, a level (Suggest by default), and a token kept as a file Redlines
  makes. Redlines serves the same six tools over MCP on a loopback port (Streamable HTTP, plus a
  stdio shim for agents that only start commands), off until someone adds a connection. The
  author is fixed by the token, never claimed by the agent. A remote agent reaches the port through
  a tunnel the person already runs (Tailscale, SSH). This covers OpenClaw (through its own
  `mcp.servers`), Hermes, Grok Build and the rest with one generated snippet each.
- **Two directions, two mechanisms.** The endpoint is _agent to Redlines_ (the agent uses the
  tools). A mention is _Redlines to agent_ (a bounded job handed to a standing agent), and that is
  the job of the agent's own inbound door: OpenClaw's Gateway through `openclaw acp --url`, Hermes's
  API server, or, for an agent with no door, a small receiver. Stephan's relay is this second
  direction: it starts an isolated run for each job. It complements the endpoint; it is not an
  alternative to it.
- **Isolation is a requirement.** A mention from a document starts an isolated run with only the
  Redlines tools and that connection's folders, and never posts into the agent's main conversation.
- **ACP stays what it is for:** Redlines starting an agent and asking it something. Its remote
  transport is still a draft; it does not solve the tools problem for OpenClaw.
- **A2A is not a fit.** It is for agents handing work to agents, not for giving an agent tools.

## What the agents support (as of November 16, 2026)

Sources are vendors' own pages where they could be read, and are marked where they are only
secondary. Dates are the dates fetched, since most pages carry none.

| Agent                                             | MCP (outbound: it uses servers)                                                                                                                                                                         | ACP                                                                                                                                                                      | Skills                                                                                              | Notes                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Claude Code, Codex                                | Yes, remote HTTP too                                                                                                                                                                                    | Through adapters                                                                                                                                                         | Own folders                                                                                         | Done natively; a provider each                                                                                                |
| OpenClaw                                          | Yes: `openclaw mcp add/set` keep servers in its config; stdio, SSE and streamable HTTP; OAuth by `openclaw mcp login` ([docs](https://docs.openclaw.ai/cli/mcp))                                        | `openclaw acp` is a server over stdio to a Gateway, local or `--url`, with `--token-file` ([docs](https://docs.openclaw.ai/cli/acp)); it rejects per-session `mcpServers` | `~/.openclaw/skills`; reads `~/.agents/skills`                                                      | Also `openclaw mcp serve`, which lets an MCP client talk to its conversations; not the direction Redlines needs                |
| Hermes Agent (Nous Research)                      | Yes, and `hermes mcp` manages servers ([docs](https://hermes-agent.nousresearch.com/docs))                                                                                                              | `hermes acp` is reported by third parties; the official page read doesn't mention it                                                                                     | agentskills.io format                                                                               | One gateway for 20+ chat platforms; runs on local, Docker, SSH and cloud backends, so often not on the Mac. Inbound door: an OpenAI-compatible API server (`hermes gateway`, port 8642, loopback by default, a bearer key required when it listens wider) with streamed tool progress, and a jobs API ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server); mirrors and guides read for details) |
| Grok Build (xAI)                                  | Yes ("bring your own MCP")                                                                                                                                                                              | Not confirmed                                                                                                                                                            | Reads Claude Code skills, plugins and `AGENTS.md`, per xAI's coverage (May 2026, secondary sources) | Beta, subscription-gated                                                                                                      |
| Muse (Meta, launched September 8, 2026)          | Through Meta's connector platform, which takes an API endpoint or an MCP server (secondary sources)                                                                                                     | No                                                                                                                                                                       | No                                                                                                  | Closed and hosted: it can only reach a server on the public internet, and Redlines should not be that                         |
| OpenMuse, NanoClaw and other self-hosted agents   | Generally yes                                                                                                                                                                                           | Varies                                                                                                                                                                   | Varies                                                                                              | Same shape as OpenClaw and Hermes                                                                                             |

What this says: MCP is the common floor; skills (the `SKILL.md` folder format) are second and
spreading; ACP is a third, narrower thing.

## The protocols

**MCP.** The current specification is the 2026-07-28 revision. Streamable HTTP is its only HTTP
transport, and authorization for it is optional and built on OAuth 2.1, with client ID metadata
documents and dynamic registration as a fallback
([spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index); found
through a search, and the secondary summaries disagree on details). For Redlines this means a local
server can start with a bearer token the person hands over as a file, and OAuth is a later step for
agents that can only sign in that way. A server on `127.0.0.1` also needs `Origin` and `Host`
checks, so that a web page can't call it.

**ACP.** Version 1 is stable and about 49 agents are listed
([registry](https://agentclientprotocol.com/registry/index), see [ai-providers.md](ai-providers.md)).
Its transport is stdio. A remote transport (Streamable HTTP and WebSocket on one `/acp` endpoint,
authentication layered on by headers) moved to Draft on April 22 and to Active on July 2, 2026,
with a reference implementation in progress
([RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)); I found no
shipped SDK support. Even when it ships, it helps Redlines _call_ a remote agent, which it can
already do through the person's own `openclaw acp --url`. It does not let the agent call back, and
that is the missing direction. ACP's `session/new` can carry an HTTP MCP server (a URL and headers)
for agents that declare they take one, so the endpoint below is also how an ACP agent that accepts
one gets its toolbox.

**A2A.** A Linux Foundation project, at version 1.0 since about March 2026, with signed agent cards
and multi-tenancy
([secondary summary](https://dev.to/eclaw/a2a-protocol-tech-update-20260317-2fl3); the spec at
a2a-protocol.org was not read). It describes how one agent delegates a task to another. Redlines
would be a tool for an agent, not a peer agent. Watch it and build nothing. If it matters later, an
agent card for the Redlines endpoint is a small addition.

## The options

| Option                                | Reach                                                                                                                        | Setup effort (person)                                                    | Security                                                                                                                                                                                                                                              | Maintenance (Redlines)                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Native, a provider per agent       | Only agents with a provider: today Claude, Codex and a text-only OpenClaw. Best polish (sign-in checks, status lines, models) | Lowest                                                                   | Redlines controls the command and the toolbox; the strongest                                                                                                                                                                                          | Highest: each agent's flags, streams and sign-in drift (see the 2026 `--bare` and Codex changes in [ai-providers.md](ai-providers.md)). Does not scale to a long tail |
| 2a. ACP                               | Any ACP agent that Redlines starts on this Mac; remote only through the agent's own bridge                                   | Add a command; OpenClaw needs a token file                               | A per-session toolbox works for most agents, but OpenClaw refuses it, so it can't edit; permission requests need a gate (exists)                                                                                                                       | Medium: one provider; the remote transport is a draft                                                                                                                   |
| 2b. MCP, Redlines as the server       | Any agent that can use MCP: all of the above. This Mac, or another through a tunnel                                          | A pasted snippet and a token file; for an agent elsewhere, a tunnel too  | Good if Redlines authenticates and scopes: author fixed by token, folders, level, revoke. A new listening surface, so loopback only                                                                                                                   | Low and shared: one server, and a snippet per agent kept in a list                                                                                                      |
| 2c. A2A                               | Agents that delegate to other agents                                                                                         | High; few personal agents expose it                                      | Agent-card signing is new                                                                                                                                                                                                                             | Not a fit; skip                                                                                                                                                         |
| 3. Command line and skill             | Any agent with a shell: on this Mac, or on another machine that has the files (synced)                                       | Install the skill; the `redlines` command on the PATH                    | Weakest: the agent writes the file itself, claims its own name, nothing is granted, so nothing can be revoked; the agent's own sandbox is the only limit. Edits arrive as outside edits, with no live merge with typing (design §7.3)                  | Lowest: one text, built into copies (exists)                                                                                                                            |
| 4. A relay add-on (Stephan's, generalized) | Any standing agent on another machine that can take a job: the relay hands it a bounded job, the reverse direction of 2b | Medium: enroll each calling machine once; a tunnel with two credentials | Good where it stands: an isolated run for each job (fresh transcript, no access to the main conversation, no way to message anyone), a cap on runs in flight, two credentials (one at the network edge, one the relay checks) in a 0600 file. Lacks, for Redlines, a folder scope, authorship fixed by the credential and a revoke from the editor | Medium: a second thing to ship; unneeded where the agent has its own inbound door |

Option 2b, with the shell route (3) kept as the zero-setup start, gives the most reach for the
least upkeep. Option 4 is not an alternative to 2b but its other half. 2b is _agent to Redlines_:
the agent uses the tools. The relay is _Redlines to agent_: Redlines hands a job to a standing
agent. A mention needs both, the job in and the tools back. A general version of the relay is the
agent's own gateway where it has one (OpenClaw's Gateway, Hermes's API server), or a small receiver
with the same properties where it has not. What Redlines adds to either is what the relay lacks: a
folder scope, authorship fixed by the credential and a revoke from the editor.

## The journey

### On one Mac, an agent in a terminal or a chat

1. **Discover.** Preferences › Agents has Add an Agent. It looks, as `which.rs` does today, for
   `claude`, `codex`, `openclaw`, `hermes`, `grok` and the other programs of the ACP registry, and
   lists what it finds, with the rest under "Another agent". One line says: "Anything that can use
   an MCP server or run commands can work in your documents."
2. **Install or connect.** Two ways, and the app picks by what the agent supports:
   - _Skill_ (agents with a shell): Install Skill, as today, into the agent's folder. The skill
     teaches the `redlines` command; it can't be limited, and the card says so in plain words.
   - _Connection_ (agents that use MCP): the sheet shows one snippet for that agent, to paste into
     its own config or to run (`openclaw mcp add …`, `hermes mcp add …`, a `.mcp.json` entry for
     the rest), with Copy. Redlines never edits another agent's config.
3. **Authenticate.** Redlines makes a token and writes it to a file in its own folder (mode 0600,
   never shown, never put in a prompt, a URL or a log); the snippet names the **path**. The agent
   reads the file, as `openclaw acp --token-file` does for OpenClaw's own Gateway token, which stays
   what it is: Redlines never reads that file. For an agent whose MCP client can only take a header
   value, a stdio shim (`redlines mcp --connect <name>`) reads the file and speaks to the endpoint, so
   the secret never enters the agent's config. The first call from a new connection waits for the
   person's yes in the app.
4. **Permissions.** The sheet asks what the agent may touch: folders (one, several, or this document
   only), read only or Suggest, and whether it may reply to comments. Default: the folders where AI
   is already on, Suggest, never Auto. A connection is the rule "an agent never has more rights than
   its person" (§8.1) with a name on it. Redlines enforces it at the endpoint: a path outside the
   folders gets the answer a missing file gets.
5. **Mention or Ask.** A connected agent is in the @ picker by its handle. Each mention is a bounded
   job, and how it reaches the agent depends on the agent's door:
   - _Redlines starts it_ (a command, ACP on this Mac): as today.
   - _The agent has an inbound door_: Redlines sends the job there. For OpenClaw that is
     `openclaw acp --url <gateway> --token-file <path>`, which exists (the Gateway is the agent's own
     relay). For Hermes it is the API server's chat endpoint (or jobs API) at a URL, with the key in a
     file; whether it can take a per-job isolated run, as OpenClaw's session key does, is to be
     tested.
   - _No door_: a waiting request, which the agent takes with a new tool, `next_request`. A fallback
     only, since it needs the agent to poll.

   Whichever, the job is an **isolated run** (see below): only the Redlines tools and this
   connection's folders, a fresh transcript, never the agent's main conversation. The thread shows
   "waiting for Moby" until it answers, and says so when it never does.
6. **See edits as tracked changes in its name.** The author is the connection's handle and the person
   (`moby-ada`), set by the token. A mention always suggests (§8.2). Each run's marks are one group,
   as now. An edit through the endpoint is the app's own write, so it merges with typing as Claude's
   does; through the command line it is an outside edit (§7.3).
7. **Revoke.** Remove deletes the token file and drops the open sessions, and keeps the agent's
   suggestions, which stay in its name. For the shell route there is nothing to revoke but the skill,
   and the card says so. A connection shows "last used" and offers an expiry (30 days, say).

### An agent on another machine

Stephan's case: the agent runs on a machine of his and the documents are on the Mac.

1. **Discover.** Add an Agent › On another machine. The sheet explains the two parts: a way to reach
   the Mac, and the connection.
2. **Reach.** Redlines doesn't open a public port and doesn't run a tunnel. The endpoint listens on
   `127.0.0.1` only, and the sheet offers two commands to copy, for tools people already have:
   `tailscale serve` (the agent's machine reaches the Mac by its tailnet name, with the tailnet's own
   identity as a second lock) or `ssh -R` from the Mac. Redlines checks that the endpoint answers and
   says what it found. A hosted agent that can only reach the public internet (Muse's connector
   platform, a cloud sandbox) is not supported, and the sheet says why: a public door to a person's
   documents is not something an editor should open.
3. **Authenticate.** The same token, as a file. The person puts it on the other machine themselves
   (`scp`, a secrets manager) and the snippet names the path there. Redlines doesn't copy it. A token
   for a remote connection is its own, with a shorter life, so that a lost machine costs one revoke.
4. **Mention: the other direction.** The tunnel carries two flows. Tools come _in_ (agent to the
   endpoint above). Jobs go _out_: Redlines hands the mention to the agent's inbound door, over an
   authenticated tunnel with the agent's own credential in a file whose path Redlines is given and
   never reads. Stephan's relay is that door for his agent: it starts an isolated run for each job,
   caps the runs in flight, and reports back once. A general door is the agent's own gateway, or a
   small receiver with those properties.
5. **Permissions, edits, revoke.** As above. The endpoint is the only writer, so the
   documents never leave the Mac, which the shell route can't give a remote agent (it would need the
   files synced, and a sync conflict would be its edits' conflict). What the agent reads goes to its
   own model host, and the first-use question says so, as it does for OpenClaw today.
6. **OpenClaw in particular.** The Gateway makes the outbound call, so the snippet is for the
   Gateway's host (`openclaw mcp add` there). The existing ACP row stays for Ask and mentions, which
   the Gateway answers in text.

### For a team

- **Whose agent.** An agent is always one person's. A connection belongs to the person who made it
  and writes as `<agent>-<person>`; a shared Mac or server doesn't hold a "team agent".
- **Rights.** A reviewer's agent can only suggest, because its person can (§8.2). In a document
  shared in a live session, the session's host enforces it per person, as it does for people
  ([multiuser.md](multiuser.md)); a connection made on a collaborator's Mac is theirs to grant.
- **Policy.** A folder can say what it allows in a file kept with it (which levels, which handles),
  as Syrus requires Suggest, so a team can write "agents suggest, never edit" once. The file only
  narrows; it never grants.
- **Shared servers.** A team host that runs sessions for many people issues one token per person and
  agent from an admin page. This is where OAuth 2.1 would replace a copied token. Not before there is
  a hosted session to put it on.

## What breaks, and what to hold

- **Secrets.** Only paths in prompts, snippets, logs and the UI, as for OpenClaw today. Tokens are
  random, 256 bits, in a 0600 file in a 0700 folder (the relay socket's rules), compared in constant
  time. There is no "copy token" button; the person copies a path or the file.
- **Isolation of a mention (required).** A personal agent can hold broad powers (a shell, other
  accounts), and a document's text, others' comments included, is untrusted. So a mention starts an
  isolated run for that job: a fresh transcript, only the Redlines tools and that connection's
  folders, no access to the agent's main conversation and no way to message anyone, one report back,
  and a cap on runs in flight. It never posts into the main conversation. Redlines asks for this
  when it hands the job over (OpenClaw: a session key for each thread, as today), says in the
  connection's card when an agent can't promise it, and does not offer mentions for such an agent
  unless the person says so after being told.
- **Prompt injection.** An agent reads others' words and may be told to act. The tool results already
  label deleted text and comments untrusted. A connection can only suggest and only inside its
  folders, which is what bounds it. The slash-directive escaping OpenClaw needs applies to anything
  that goes to a Gateway.
- **Local web pages.** A loopback server is reachable by any page the person opens. Hold: `Origin`
  and `Host` checks, a token on every request, no CORS.
- **Identity.** The shell route lets any agent write as anyone (`--as`); the endpoint doesn't. An
  agent that has both can use the shell, and only its own sandbox stops that. The card says
  "Redlines limits what this connection does, not what the agent does elsewhere."
- **Races.** Two connections editing one document: every write goes through the app's single writer,
  as now.
- **Terms.** Nothing about Claude's or ChatGPT's credentials changes: no vendor's token passes
  through Redlines, only Redlines' own.

## Recommended path

_Superseded for OpenClaw, as the revision above says: its Phase 1 and 2 become the node in
[openclaw-connection.md](openclaw-connection.md). Phase 0 and the rest stand for the other agents._

**Phase 0, small, now.** Close the gaps that already hurt; no new design.

- Reply-only Ask for an agent with no toolbox (#401): the document and selection in the prompt, the
  answer in the bubble.
- A fixed, validated form in which an agent that can't call tools _proposes_ edits in its reply,
  which Redlines applies as suggestions in its name at Propose or Suggest level. This lets the ACP
  OpenClaw agent edit with no new surface. The weakness: it relies on the model producing the form.
- Offer the skill's install and a copyable command-line line for Hermes and Grok Build, which read
  `SKILL.md` (Grok reads Claude's folder, Hermes the agentskills.io one; confirm the paths on real
  installs).

**Phase 1: one Mac, a standing local connection.** `redlines mcp --connect <name>` (the stdio shim)
and a loopback listener in the app; a connection record (handle, folders, level, token file); the
grant prompt on first use; revoke and last used; the author fixed by the token. The Add an Agent
sheet with a snippet per agent (OpenClaw, Hermes, Grok Build, generic). Tested against the real
programs, as the Claude and Codex providers were.

**Phase 2: another machine, both directions.**
- _Tools in:_ Streamable HTTP on the listener, the Origin and Host checks, the two tunnel recipes,
  a shorter token life and the reachability check.
- _Jobs out:_ a mention goes to the agent's own inbound door, each job isolated. OpenClaw first
  (`openclaw acp --url … --token-file …`, which exists, with the endpoint registered at the Gateway
  by `openclaw mcp add`), then Hermes's API server once a real install shows a job can be isolated.
- _No door:_ the waiting-request tool, as a fallback only.

Stephan's relay is the working example of the jobs-out direction, not a program to port first.

**Phase 3: the long tail and teams.** A small receiver for agents with no inbound door, with the
relay's properties (isolated run per job, a cap, two credentials) and Redlines' additions (folder
scope, authorship fixed by the credential, revoke from the editor); this is the one place a port of
the relay may still be worth it. Hand the endpoint's URL to ACP agents that declare they take an
HTTP MCP server; OAuth 2.1 for agents that can only sign in that way and for shared servers; folder
policy files; ACP's remote transport if the draft ships and agents adopt it.

Not planned: a provider per agent beyond Claude and Codex; an A2A server; a public or hosted relay;
Redlines running anyone's tunnel.

## Open questions for Stephan

1. **Resolved: what Stephan's relay does.** Its design shows the push direction (a caller hands a
   bounded job to a standing agent on another machine) and isolation (a fresh run for each job, no
   access to the main conversation, one report back, a cap on runs in flight, two credentials). A
   general version is the agent's own gateway, or a small receiver with the same properties. Porting
   it as an add-on is not needed for OpenClaw, whose Gateway is that door already, and probably not
   for Hermes, which has an API server. It may be worth it for an agent with no inbound door; that is
   phase 3, after real agents show how many there are. (I did not read the relay or any machine; this
   is from the description the project gave.)
2. **Is Tailscale or SSH an acceptable stated way to reach the Mac?** The alternative is to ship a
   tunnel, which I would rather not own.
3. **A standing endpoint is a new surface on a text editor.** Off until the first connection,
   loopback only, a grant for each: is that the right level of comfort?
4. **Which agents should get real installs to test with?** OpenClaw is the one the design knows;
   Hermes and Grok Build are read only from docs and coverage.
5. **Mentions of a standing agent:** the agent's own door first, and `next_request` only for an agent
   with none. Is it acceptable that an agent that can't promise an isolated run gets no mentions
   unless the person insists?
6. **Muse and other hosted agents:** say no, as above, or offer a hosted, signed-in bridge later
   (a product with a backend, against the open-source, no-backend stance)?
7. **A team policy file:** kept in the repository next to the documents, or only in Preferences?
8. **Expiry:** should a connection expire by default?

## Sources

All fetched November 16, 2026. Secondary sources are marked in the text.

- OpenClaw: [`openclaw acp`](https://docs.openclaw.ai/cli/acp), [`openclaw mcp`](https://docs.openclaw.ai/cli/mcp)
- Hermes Agent: [docs](https://hermes-agent.nousresearch.com/docs), [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) (details also from third-party guides; `hermes acp` and inbound webhooks not confirmed)
- ACP: [transport RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport), [registry](https://agentclientprotocol.com/registry/index)
- MCP: [authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index)
- A2A: [summary, March 2026](https://dev.to/eclaw/a2a-protocol-tech-update-20260317-2fl3)
- Grok Build: [xAI's page](https://x.ai/cli) and press coverage of May 2026
- Muse: [Meta's announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) and trade coverage
- In this repository: design §7.3 and §8, [ai-providers.md](ai-providers.md),
  [multiuser.md](multiuser.md), [`integrations/README.md`](../../integrations/README.md); issues
  #322, #357, #382 and #401
