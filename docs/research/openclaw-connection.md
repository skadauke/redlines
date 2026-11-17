# Connecting to an OpenClaw agent on another computer

Status: research and design note, November 16, 2026. Built since, November 17, in Epic #930 (lane
OC), short of a live connection: see [First live test](#first-live-test). The design below is from
the vendors' own documentation; nothing was installed or run, and no machine, agent or
configuration of anyone's was touched.

[agent-connections.md](agent-connections.md) asked how any agent should connect, and recommended a
Redlines MCP endpoint on a loopback port plus a tunnel the person runs. For OpenClaw that is
superseded by a direction from Stephan: **build native adapters, OpenClaw first, over Tailscale**,
because that is what OpenClaw itself does. The proximate goal is a polished setup for an OpenClaw
agent whose Gateway may be on a different computer, with the server side made easy by a prompt the
person gives their agent. This note finds the native road, designs the journey screen by screen,
and plans the work. The findings of the earlier note stand.

## Summary

- **The agent acts on documents as a node's tools.** OpenClaw has _nodes_: companion devices that
  connect **out** to the Gateway over a WebSocket (role `node`) and publish tools that agents can
  call. A node host can declare MCP servers (`nodeHost.mcp.servers`), publishes their tools to the
  Gateway, and the Gateway routes each call back to the node as `mcp.tools.call.v1` over that same
  connection. This is OpenClaw's own native way for an agent to use something that lives on another
  machine, and it needs **no inbound port on the Mac and no tunnel to the Mac**: the Mac dials out.
  Redlines becomes a node whose tools are the six it already has (`packages/agent-tools`).
- **Tailscale is the road the Mac dials out on.** The Gateway stays on loopback and OpenClaw's own
  `gateway.tailscale.mode: serve` puts it on the tailnet as `wss://<name>.<tailnet>.ts.net`, with
  Gateway auth still on. Redlines checks that Tailscale is installed, signed in and can see the
  computer, in plain words, and never changes Tailscale.
- **Setup is one prompt and one code.** Redlines writes a prompt (with Copy) that asks the person's
  agent to set up its side and to answer with a **setup code** (what OpenClaw's own iPhone app
  takes). The person pastes the code into a secure field once. Redlines exchanges it, keeps what it
  gets in 0600 files, and never shows it again. The agent then approves a pairing request, which
  Redlines shows a short code for, so the person can check it is the right one.
- **Replies and mentions go the other way** over the same WebSocket, as an _operator_ client (send a
  message to a session, stream the answer), so a Mac without the `openclaw` program needs nothing
  else. Today's `openclaw acp` bridge stays for a Mac that has it.
- **Open points, all to be settled on a throwaway Gateway** (list below): the exact frames of the
  node and operator calls (the docs name them; the schemas are in OpenClaw's source), whether a
  third-party app may be a node at all (the docs describe only OpenClaw's own), which agent a tool
  call came from, and whether the setup code works for a non-mobile client.

## What OpenClaw's documentation says

All read November 16, 2026 at docs.openclaw.ai, except where marked. Where a page did not say, it
is marked _not stated_. OpenClaw's docs are versioned and change quickly; the pages carry no dates.

### Reaching the Gateway from another machine

The Gateway's WebSocket listens on loopback, port 18789, by default
([remote access](https://docs.openclaw.ai/gateway/remote)). A client reaches a remote one in
three ways: an **SSH tunnel** (`ssh -N -L 18789:127.0.0.1:18789 user@host`, or
`gateway.remote.sshTarget` so the CLI makes it), a **direct** `ws://` or `wss://` URL on a tailnet
or LAN, or **Tailscale Serve**. Plain `ws://` is accepted by clients for loopback, private LAN,
CGNAT, `.local` and `.ts.net` hosts; public hosts must use `wss://`.

How the Gateway is put on the tailnet ([Tailscale](https://docs.openclaw.ai/gateway/tailscale)):

| Setting                                        | What it does                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.tailscale.mode: serve`                | The Gateway stays on loopback; `tailscale serve` gives it HTTPS on the tailnet. The recommended road. Needs HTTPS enabled for the tailnet.    |
| `gateway.tailscale.mode: funnel`               | Public internet. Refused unless auth is `password`. **Redlines never asks for this**, and the prompt says not to.                              |
| `gateway.bind: tailnet`                        | Listens on the tailnet address directly, plain `ws://<tailscale-ip>:18789`; auth required.                                                    |
| `openclaw gateway --tailscale serve`           | The same as the first row, from the command line.                                                                                             |

Auth (`gateway.auth.mode`): `token` (the default), `password`, `none` (private ingress only) or
`trusted-proxy`. Every non-loopback bind needs auth. `gateway.auth.allowTailscale: true` lets
Tailscale's identity headers (checked with `tailscale whois`) stand in for the token, but **only
for the Control UI's WebSocket**; other clients use the normal auth, and device identity is still
required. A client given `--url` never falls back to stored credentials. The docs say to prefer
token files over flags, because flags show in process lists.

### Pairing and approval

([pairing](https://docs.openclaw.ai/gateway/pairing), [devices](https://docs.openclaw.ai/cli/devices))
Two layers. **Device pairing** gates the connection: the first connect makes a pending request,
which expires after 5 minutes. **Node capability approval** is separate: the node's first declared
command list makes a second pending request that does not expire, and until it is approved the
node's commands do not run. On the Gateway: `openclaw devices list`, `openclaw devices approve
<requestId>`, `openclaw nodes pending`, `openclaw nodes approve <id>`. The macOS app of OpenClaw
shows both in one panel (Approve Node). Approving anything with `system.run`, `fs.listDir` or
`browser.proxy` needs `operator.admin`.

Approval is automatic in a few cases: first-time pairing **from the same machine** (loopback);
**SSH-verified** for a first-time node from a private, CGNAT (which is Tailscale's range) or
link-local address, where the Gateway SSHes to the host and checks the device identity (on by
default; it needs the Gateway to be able to SSH to the Mac, which will usually fail on a Mac that
doesn't allow it, and then it falls back to manual); trusted CIDR ranges (opt-in). Operator,
browser and Control UI clients **always** need a manual approval.

A **setup code** is the smoother road: `openclaw qr` (or the Control UI, Devices › Connect a
device) makes a code that carries an opaque, short-lived bootstrap token, not the shared token; the
OpenClaw docs give 10 minutes and single use for node links
([pairing](https://docs.openclaw.ai/gateway/pairing)) and do not state them for the mobile code
([`openclaw qr`](https://docs.openclaw.ai/cli/qr)). It hands the app a node token and an operator
token in one step (`--limited` drops `operator.admin`; plaintext LAN `ws://` gets the limited
profile automatically). `openclaw devices rotate` and `revoke` take access away later.

### How OpenClaw's own apps connect: the model for the screens

- **macOS app** ([macOS](https://docs.openclaw.ai/platforms/macos),
  [remote](https://docs.openclaw.ai/platforms/mac/remote)): a **Gateway mode** choice, **Local**
  (this Mac) or **Remote** (another host, over SSH, LAN or tailnet); a Connection window, with a
  Gateways tab to add one by host name or HTTPS address; SSH by default with a strict host-key
  check, or a direct `ws`/`wss` URL; browser sign-in for Gateways behind an identity proxy;
  shared tokens only as a fallback, and secrets passed by file or stdin. It also runs a Mac
  **node** in both modes. The page for the app's setup fields was not fully readable; the screens
  are known only in outline.
- **iOS app** ([iOS](https://docs.openclaw.ai/platforms/ios)): five steps. 1. Find the Gateway:
  Bonjour on the LAN, a Tailscale DNS-SD zone, or **Use Manual Gateway** (host and port; a
  `.ts.net` name without a port means 443 with TLS). 2. On the Gateway, make a **setup code**
  (the Control UI's Devices page, or `openclaw qr`). 3. In the app, **scan or paste the code**.
  4. **Approve**: the app shows _Pending approval_, and the Gateway's owner approves the request
  (the app names `openclaw devices list` and `approve` as the fallback). 5. Verify. Its
  failure list is a model for ours: setup incomplete, refused or timed out (it names the address
  tried), approval prompt never appears, expired or used code, lost credentials after a reinstall.
  Plaintext `ws://` is limited, to protect the token; it points to Tailscale Serve and `wss://`.

So OpenClaw's own answer to "a client on another device" is: **reach it by tailnet name, paste a
setup code, get approved by the Gateway's owner**. The Redlines journey follows that, with the
agent's side done by a prompt.

### Acting on documents that live on the Mac

Four candidates, in the documentation's own terms:

1. **A node with a hosted MCP server (native).** A node host declares MCP servers under
   `nodeHost.mcp.servers`; it "starts or connects to servers, and publishes their tool descriptors
   to the Gateway", which "can then allow those tools without a matching server entry". Calls come
   back as `mcp.tools.call.v1`; changes apply live; tools vanish from new runs when the node
   disconnects ([node MCP and skills](https://docs.openclaw.ai/nodes/mcp-and-skills),
   [`openclaw node`](https://docs.openclaw.ai/cli/node)). The node "opens an outbound
   WebSocket to the Gateway". A node can't invent new command ids; it publishes plugin or MCP tools
   whose command is in its approved list (`node.pluginTools.update`, in
   [the handshake](https://docs.openclaw.ai/gateway/protocol/handshake)). Operators can switch it
   off with `gateway.nodes.pluginTools.enabled: false` or deny the command with
   `gateway.nodes.commands.deny`. Limits: OAuth-protected MCP servers aren't supported on this
   path; it is a node's tools, so every agent on the Gateway that the Gateway's tool policy lets
   see them can call them.
2. **An MCP server the Gateway reaches back to over the tailnet.** `openclaw mcp add` keeps
   servers in the Gateway's config, stdio, SSE or streamable HTTP
   ([MCP](https://docs.openclaw.ai/tools/mcp)). It works only if the Mac accepts a connection from
   the Gateway: an inbound port on the Mac, kept up by Redlines, and a second credential. This is
   the earlier note's option 2b. It stays valid for agents that are not OpenClaw.
3. **`openclaw acp --url … --token-file …`, replies only** (what Redlines has today). The bridge
   refuses per-session `mcpServers` and the client's file and terminal methods
   ([`openclaw acp`](https://docs.openclaw.ai/cli/acp)). Text in, text out; no edits.
4. **Skills on the Gateway** (the `redlines` command). Useless where the files are on the Mac; a
   node can publish its own skills, but the agent then reads them and runs commands _on the node_
   (`system.run`), which Redlines must never allow.

**Which is native?** Option 1 is OpenClaw's own mechanism for exactly this: it is how its macOS and
iOS apps give an agent a camera or a screen on another machine. **Through NAT with no inbound port
on the Mac, only option 1 works** (and option 3, for replies): the Mac makes every connection. The
Gateway needs to be reachable from the Mac, which Tailscale Serve gives wherever Tailscale runs.

## Tailscale on the Mac

([CLI](https://tailscale.com/kb/1080/cli), [variants](https://tailscale.com/kb/1065/macos-variants),
[MagicDNS](https://tailscale.com/kb/1081/magicdns), [status
fields](https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go), read November
16, 2026.)

- **Three variants.** _Standalone_ (a system extension, downloaded from Tailscale; its page says to
  start there), the _Mac App Store_ app (sandboxed, no `tailscale ssh`, no Funnel) and the open
  source `tailscaled` (command line only, for administrators). The standalone and App Store apps
  must not be installed together. Redlines should offer the standalone download and never sell
  the variants to the person.
- **Where the command is.** The App Store variant bundles it: run
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale <command>`. The standalone variant installs
  a launcher to `/usr/local/bin/tailscale` only if the person turns on **CLI integration** in its
  settings; its app bundle holds the same binary. A Homebrew install puts `tailscale` on the PATH
  (its path is not in these pages). **Detection is therefore: `/Applications/Tailscale.app`
  exists, or a `tailscale` command is found; call the bundle's binary by its full path.** From a
  script the binary may open the GUI unless `TAILSCALE_BE_CLI=1` is set.
- **Signed in and able to see others.** `tailscale status --json` gives `BackendState` (`NoState`,
  `NeedsLogin`, `NeedsMachineAuth`, `Stopped`, `Starting`, `Running`), `AuthURL` when it needs a
  login, `Self`, `Peer` (a map: `HostName`, `DNSName` with a trailing dot, `OS`, `TailscaleIPs`,
  `Online`, `Tags`, `ShareeNode`), `CurrentTailnet` (its name and `MagicDNSSuffix`) and `Health`.
  When the app isn't running, the command fails to connect: that is "Tailscale is turned off".
- **Names.** MagicDNS gives each machine `<name>.<tailnet>.ts.net`; tailnets made since October
  20, 2022 have it on. Machines shared from another tailnet need the full name. Serve's HTTPS
  needs HTTPS enabled for the tailnet, which OpenClaw's page lists as a prerequisite.
- **What the Mac can see.** Only the peers the tailnet's access rules let it reach; a tightened
  policy can hide machines, and a shared-in machine is hidden by default. So "not listed" is not
  "not on your network", and the screen must let the person type a name.
- Not found in these pages, to check on a real Mac: the app's bundle identifiers for each variant,
  and whether `status --json` is allowed to the sandboxed App Store app from another program.

## The journey

Five steps, in plain words, and a Preferences pane at the end. Mockups, in light and dark:
[`mockups/openclaw-connection.html`](mockups/openclaw-connection.html) (open it for all frames,
`#f4` for one, `?dark` for dark); pictures on the `screenshots/OCD` branch. They use the Default
theme's tokens, and failures are gray, as the app's notifications are.

| #  | Screen                                  | What the person sees and does                                                                                                                                                                                         | Behind it                                                                                                                                                                                      |
| -- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Start** (Add OpenClaw)                | Two rows: **On this Mac**, **On another computer**. A line says which to pick.                                                                                                                                        | This Mac: the existing finder (`which.rs`), the Gateway on `127.0.0.1`, loopback pairing is automatic, then straight to the test. Another computer: the rest of this list.                      |
| 2  | **Check this Mac**                      | Three checks: Tailscale installed, signed in, sees other computers. Each with a plain line. Not installed: **Download Tailscale** and "Redlines notices by itself". Ready: a checklist and Continue.      | The `status --json` reading above, repeated every few seconds while the screen is open. Never starts, stops or changes Tailscale; **Open Tailscale** only opens the app.                        |
| 3  | **Choose the computer**                 | The computers the tailnet shows (name, system, on now), the offline ones dimmed, and a field for a name or address. After a pick: "Found an OpenClaw Gateway on studio-mini", or why not.                              | Redlines opens `wss://<name>` and reads the Gateway's first frame, `connect.challenge`, then closes: nothing is sent, so no auth is tried. Port 443 for `.ts.net` names, else 18789.            |
| 4  | **The other computer's side**           | The prompt (below) in a box, **Copy prompt**; "Nothing changes until your agent does it." Under it a secure field: "When your agent answers with a setup code, paste it here." **Connect**.                           | The prompt names this Mac, the tailnet and what to approve, and holds **no secret**. The code is exchanged for tokens; both go to 0600 files, never to the screen, a log or a URL.              |
| 5  | **Approval**                            | A short code (for example `7QF2-K9`) in large type, and three lines: reached the Gateway, approve this Mac, approve the Redlines tools. "Asked 40 seconds ago. The request lasts 5 minutes." **Ask again**.        | The code is the first characters of this Mac's device id; the agent reports the pending request's id from `openclaw devices list`, and the person compares. Pairing, then node approval.        |
| 6  | **Test**                                | Redlines makes a practice note with one typo and asks the agent to fix it. The tracked change appears in the agent's color, with the agent's one-line answer. Two checks: it answered; it used the tools. **Finish**. | The ask is an isolated session (below). The note is a scratch file in Redlines' own folder, deleted on Finish.                                                                                  |
| 7  | **Done**                                | The agent in Preferences › Agents: name, computer, **Writes as** (`moby-ada`), **Level** (Suggest by default), **Folders**, last used, **Test again**, **Remove…**. And in the @ picker under its name.            | Level and folders are the existing agent controls. Remove deletes the token files, tells the Gateway to forget the device if it can, and keeps the agent's past suggestions in its name.        |
| 8  | **Every failure**                       | A gray card each, in plain words, with one button; the eight in the mockup.                                                                                                                                           | See the table below.                                                                                                                                                                           |

"On this Mac" is the same journey with no screens 2, 3 and the approval wait: the Gateway is on
loopback, where OpenClaw approves a first pairing silently (the pairing page).

### The prompt (screen 4)

Redlines fills in this Mac's name and tailnet name. It never contains a token, a password or a
path to one.

```text
I'm connecting the Redlines editor on my Mac ("<Mac name>", <name>.<tailnet>.ts.net) to you, so
that you can suggest edits in my documents. Please set up your side of it. Tell me before you
change anything that opens access, and never send me a password or token in the chat, except
the setup code in step 4.

1. Check that Tailscale is running on this computer, signed in to the same Tailscale network as
   my Mac, and that HTTPS is enabled for the network. If not, tell me what to do.
2. Make the Gateway reachable on that network only: keep gateway.bind on loopback and set
   gateway.tailscale.mode to serve. Do not use funnel. Keep Gateway auth on.
3. Redlines will connect as a node and offer tools named by an MCP server. Make sure
   gateway.nodes.pluginTools.enabled is not false and mcp.tools.call.v1 is not denied. Never
   approve system.run or any command other than mcp.tools.call.v1 for it.
4. Make a setup code for a full-access, non-limited device with `openclaw qr --remote
   --setup-code-only` (or Devices > Connect a device in the Control UI) and send it to me as
   the only thing in a message by itself. It works once.
5. When Redlines connects, tell me the pending device request's id and the code I'll see
   (the first characters of its device id), wait for my yes, then run `openclaw devices
   approve <id>` and `openclaw nodes approve <id>`.
6. Make the Redlines tools available to <agent name> only, and only for runs I start from
   Redlines; tell me how you did that. Then tell me the name I should type after @, and
   what you changed.
```

Step 6 asks for the isolation the earlier note requires. Whether an OpenClaw agent can do it
(tool policy per agent) is one of the points to test.

### Failures (screen 8)

| Where    | The person sees                                           | The one action                                                    | What happened                                                                                       |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Step 2   | Tailscale is turned off on this Mac                       | **Open Tailscale**                                                | The command couldn't connect, or `BackendState` is `Stopped` or `NeedsLogin` (then its `AuthURL`).  |
| Step 2   | Tailscale is not on this Mac                              | **Download Tailscale**                                            | No app and no command found.                                                                        |
| Step 3   | _studio-mini_ isn't answering                             | **Check again**                                                   | Offline peer, or no reply in 8 seconds.                                                             |
| Step 3   | This network blocks Tailscale                             | **Try again** (and a line: try another network, such as a hotspot) | `status` shows Running but nothing, not even a ping, reaches any peer, or `Health` says so.         |
| Step 3   | No OpenClaw found on _studio-mini_                        | **Copy a prompt for your agent**                                  | Connection refused or no `connect.challenge`. The prompt is steps 1 and 2 only.                     |
| Step 4   | That setup code has been used or has run out              | **Copy the request for a new code**                               | The Gateway refused the bootstrap token.                                                            |
| Step 5   | Nobody approved this Mac in 5 minutes                     | **Ask again**                                                     | The device request expired.                                                                         |
| Step 6   | Connected, but _Moby_ can't use the Redlines tools        | **Copy a prompt for your agent**                                  | Tools not published, node commands not approved, or the Gateway's node tools are off.               |
| Step 6   | _Moby_ didn't answer in a minute                          | **Try again**                                                     | The run didn't finish; nothing was changed in any document.                                         |
| Later    | _Moby_ is not connected (in the picker, grayed)           | **Reconnect** in Preferences                                      | The Gateway is off or the Mac is on another network; Redlines retries by itself with a backoff.     |

The wording avoids "node", "bootstrap", "device token" and "Gateway" except where the person has
seen the word: the prompt's reply names the Gateway, since OpenClaw's own apps do. The details a
person might send to someone (the Gateway's error text, the step) sit under **Details**.

## Secrets

- The setup code is pasted into a secure field once and exchanged at once. It is never in the
  prompt, a log, a URL or a screenshot, and the field is cleared.
- What the exchange gives (a node token, an operator token and this Mac's device key) goes to files in
  Redlines' folder, mode 0600 in a 0700 folder, like the relay socket's rules and the token file
  OpenClaw's bridge reads. They are never shown again, and there is no "copy" button. Remove
  deletes them.
- **Redlines never reads OpenClaw's files** (`~/.openclaw`, the Gateway's token) on this Mac or
  elsewhere, as today. If the person has OpenClaw on this Mac too, the node Redlines starts, where
  Redlines uses OpenClaw's program, runs with its own `OPENCLAW_STATE_DIR` and
  `OPENCLAW_CONFIG_PATH`, which the docs support, so it has its own identity and never touches the
  person's own.
- "I have a token instead" is an advanced link that takes the Gateway's token in the same secure
  field and writes the same file; it is for a Gateway where the person can't make a setup code.
- Tailscale's own sign-in is Tailscale's: Redlines never sees it.

## Choice: how the agent acts on documents

**A native node, with the six tools as its hosted MCP server.** Reasons: OpenClaw's own
mechanism; outbound-only from the Mac, so it works behind NAT and on any network that lets
Tailscale through, with no port opened and no tunnel for tools; one approval flow that OpenClaw's
people already know; and the tool calls still go through the app's single writer, so edits merge
with typing as Claude's do. Cost: it ties Redlines to the node protocol, which is OpenClaw's
and moves.

Two ways to be the node, in order:

- **Spike first: OpenClaw's own program as the node host.** The Mac needs the `openclaw` program;
  Redlines starts `openclaw node run` with its own state folder and a config that has
  `nodeHost.mcp.servers` pointing at `redlines mcp …`, and `--commands mcp.tools.call.v1`
  so that `system.run` is never advertised. Little code; proves the road end to end; but asks a
  person with only a remote Gateway to install OpenClaw on the Mac.
- **Then native: Redlines speaks the node protocol itself**, in the app's Rust, so that nothing but
  Redlines and Tailscale is needed on the Mac. It is a few frames: read `connect.challenge`; send
  `connect` with `role: node`, `commands: ["mcp.tools.call.v1"]`, the device identity and its
  signature of the nonce; keep the device token from `hello-ok`; publish the six tools with
  `node.pluginTools.update`; answer `mcp.tools.call.v1`. The schemas are in OpenClaw's source
  (`packages/gateway-protocol`), which the docs name as the authority; the first PR of the work
  reads them and pins the version it was built against, with a probe that says "this Gateway is
  newer than Redlines knows" rather than failing strangely.

**What isn't settled by documentation, and is the first thing to test:**

1. **Who called.** The Gateway routes a tool call from one of its agents; whether the call says
   which agent or session is not stated. If not, Redlines can fix the author by _connection_
   (`moby-ada`) but not by session, and cannot tell a mention's run from the agent's other chats.
   The bound is the same as before (folders and level; a Suggest-level connection can only
   suggest), and the card says "Redlines limits what Moby does in your documents, not what Moby does
   elsewhere", but the isolation of mentions then rests on the Gateway's tool policy, which step 6 of
   the prompt asks for. If that can't be shown to hold, mentions of such an agent are off until the person says so.
2. **Whether the Gateway accepts a third party as a node.** The docs describe OpenClaw's apps and
   `openclaw node`; the protocol page says clients declare `caps`, `commands` and `permissions`, so
   it looks open, but _not stated_.
3. **The setup code for a client that is not the mobile app.** `openclaw qr` is described for
   Android and iOS; a non-official client may need an approval (`devices approve`), which the
   journey has anyway. If a Mac client can't use it, the fallback is `openclaw devices join-code`
   (a single-use node onboarding link, which "carries administrator access") or the token.
4. **What the Mac may be refused**: `gateway.nodes.commands.deny`, tool profiles.

### Replies and mentions (Redlines to the agent)

- **First, as today:** `openclaw acp --url … --token-file …`, which needs the `openclaw` program on
  the Mac and a token file, and the agent's tools are the node's. Together, the node (for edits) and
  the bridge (for replies) already give a mention: Redlines sends the thread and document text
  through the bridge, the agent edits through the node's tools.
- **Then native:** Redlines as an _operator_ client on the same WebSocket, sending the job to a
  session and reading the streamed answer (the docs list session control, with run lifecycle, among
  the RPC families; the method names are in the schema and were not in the pages read). An operator
  always needs manual approval, so the approval flow has two requests: the node and the operator.
  The setup code carries both, as the iPhone's does.
- Each job keeps today's isolation: its own session key per thread
  (`redlines-<hash>`, never the document's path), the slash-directive escaping, one report back.

## What this changes in the earlier note

See the revision at the head of [agent-connections.md](agent-connections.md). In short: for
OpenClaw, native adapters over Tailscale replace "an endpoint on loopback plus a tunnel the person
runs"; the endpoint stays for agents that are not OpenClaw (Hermes and the rest), and for a Mac
that cannot use Tailscale.

## Hands-on tests that need Stephan's OK

Nothing below was done. Each installs something, opens a network connection, or touches his
accounts.

1. **A throwaway local Gateway on this Mac** (install OpenClaw in a scratch folder with its own
   `OPENCLAW_STATE_DIR`, on a spare loopback port, no model key, removed afterwards). It would
   settle every open point except Tailscale: the node frames; whether a third-party client is
   accepted; the tool list the agent sees; whether a call says which agent made it; the setup
   code's contents; the approval prompts' wording; and the schema version.
2. **Tailscale on this Mac**: installing the standalone app and signing in (a new device on his
   tailnet), to see `status --json` for each state, the CLI's paths for each variant, and what the
   Mac sees; and, with the throwaway Gateway in `serve` mode on a second machine, the whole road.
   Reading a state only, with the app he already has, is a smaller ask.
3. **His real agent, once**, with the prompt of step 4 sent by him: what it does, whether the
   approvals read as designed, and whether it can scope the tools to one agent.
4. **A network that blocks Tailscale**: from a place where it fails, to see what `status` and
   `Health` say, so the failure's wording is true.
5. **Both Mac variants** of Tailscale (App Store and standalone), on a spare Mac or a clean user,
   for the paths and the bundle identifiers.

## Plan: eight PRs

An integration branch, merged when the whole journey works, in the order below. Estimates are
for a lane, as in the epic notes: 10 to 40 minutes each.

| #  | PR                                                                                                                                                                              | Estimate  |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1  | **Tailscale check.** `tailscale.rs`: find the command, run `status --json` with a timeout and `TAILSCALE_BE_CLI=1`, turn it into one state (missing, off, signed out, no peers, ready) and a list of computers. Fixture JSON for each state; no live Tailscale in tests. | 20 min    |
| 2  | **Gateway probe and address rules.** Reuse the address checks of `acp.rs`; accept `wss://*.ts.net`; open the WebSocket, read `connect.challenge`, close; classify the failures. Tests against a local stub server. | 25 min    |
| 3  | **Connection record and secrets.** The record (name, computer, agent, level, folders), 0600 token files in a 0700 folder, the device key, Remove, and the command permissions. Tests for modes and never-in-logs. | 30 min    |
| 4  | **The node connection.** The handshake, the device signature, pairing states (pending, approved, refused, expired), reconnect with backoff, the schema version pin. First read of OpenClaw's schemas; first run against the throwaway Gateway. | 40 min    |
| 5  | **The tool bridge.** Publish the six tools, answer `mcp.tools.call.v1` through the existing tool host with the author fixed by the connection, folders and level enforced. Journey: a tool call suggests a change in the agent's name. | 35 min    |
| 6  | **The setup sheet.** Screens 1 to 8 as designed: Preferences › Agents › Add OpenClaw, the prompt, the secure field, approval code, test with the practice note, the failure cards, the agent's card and the @ picker. Journeys and screenshots in light and dark. | 40 min    |
| 7  | **Mentions through the same connection.** The operator client on the WebSocket (replies, streamed), per-thread session keys, the isolation checks, the first-run question; the bridge stays for a Mac that has it. | 35 min    |
| 8  | **The docs and the skill.** `design.md` §8.6, the prompt's text kept in one place and tested for secrets, and the website's list of agents. | 15 min    |

PR 6 can start from the mockups as soon as 1 and 2 are in. PRs 4 and 5 are the risk, and the
throwaway Gateway is how they are checked; if the third-party node turns out to be refused, the
fallback is the spike (OpenClaw's own program as the node host), which changes PR 4 and leaves the
rest.

## Open questions for Stephan

1. **The hands-on tests above**, in the order 1, 2 (read only), then 3.
2. **OpenClaw's program on the Mac.** Is it acceptable that the first version asks for it (the
   spike), if the native node takes longer than the Epic?
3. **Agents on the same Gateway.** If a call can't be tied to a session, are connection-level
   folders and Suggest enough, with mentions off until the person says so?
4. **Tailscale's HTTPS and Serve** (a tailnet setting the person's agent can't change for them): say
   so in the prompt, as drawn, or offer SSH as the second road?

## Sources

All read November 16, 2026. Secondary: none used for claims; two pages were summarized in part
and are marked in the text.

- OpenClaw: [Tailscale](https://docs.openclaw.ai/gateway/tailscale),
  [remote access](https://docs.openclaw.ai/gateway/remote),
  [pairing](https://docs.openclaw.ai/gateway/pairing),
  [nodes](https://docs.openclaw.ai/nodes),
  [node MCP and skills](https://docs.openclaw.ai/nodes/mcp-and-skills),
  [`openclaw node`](https://docs.openclaw.ai/cli/node),
  [`openclaw devices`](https://docs.openclaw.ai/cli/devices),
  [`openclaw qr`](https://docs.openclaw.ai/cli/qr),
  [`openclaw acp`](https://docs.openclaw.ai/cli/acp),
  [MCP](https://docs.openclaw.ai/tools/mcp),
  [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) and
  [handshake](https://docs.openclaw.ai/gateway/protocol/handshake),
  [macOS app](https://docs.openclaw.ai/platforms/macos) and
  [remote control](https://docs.openclaw.ai/platforms/mac/remote),
  [iOS app](https://docs.openclaw.ai/platforms/ios)
- Tailscale: [CLI](https://tailscale.com/kb/1080/cli),
  [macOS variants](https://tailscale.com/kb/1065/macos-variants),
  [MagicDNS](https://tailscale.com/kb/1081/magicdns),
  [Tailscale SSH and access rules](https://tailscale.com/kb/1193/tailscale-ssh),
  [`ipnstate.go`](https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go)
- In this repository: design §8, in particular §8.6;
  [agent-connections.md](agent-connections.md); `apps/desktop/src-tauri/src/agents/acp.rs`,
  `acp_gate.rs`, `which.rs`; `packages/agent-tools`; issues #322 and #401

## First live test

What Epic #930 built, and what waits for a real Gateway. Nothing below has been done: each step
installs something, opens a connection or touches his accounts, so each waits for Stephan's yes.

**Built, and tested without a Gateway:** the Tailscale reading (fixture JSON), the address rules and
the Gateway probe (a stub server), the connection record and its 0600 files, the node client
(handshake, signature, pairing, tools, calls, retries) against a fake Gateway that checks the
signature as a Gateway would, the prompts, the setup sheet with every failure card, and the
agent's card.

**Not built:** the tool bridge (which document a Gateway agent's call acts on, with the author fixed
by the connection and the folders and level enforced), mentions through the connection (the
operator client, per-thread sessions, the @ picker), and the sheet's practice-note test (the sheet
finishes without it and says so).

**Where the code guesses**, all in `apps/desktop/src-tauri/src/agents/openclaw_protocol.rs` (frames,
the signed text, the refusals' words), `gateway.rs` (`is_challenge`) and `tailscale.rs` (the words
of `Health`):

1. The greeting, `connect.challenge` with a `nonce`.
2. `connect`'s fields, the device id (SHA-256 of the key), the signed text (`v2|id|client|role|...`),
   `auth.token` and `auth.bootstrapToken`, and `hello-ok` with `auth.deviceToken`.
3. `node.pluginTools.update`, `node.invoke.request` and `node.invoke.result`.
4. Which words and codes a Gateway uses for a pending approval, a used code, a bad token and a newer
   protocol.
5. Whether a used setup code is spent by a connection that ended in "pairing required" (the node
   offers it again), and whether a Gateway takes a third party as a node at all.
6. What Tailscale's `Health` says on a network that blocks it.

**The steps Stephan would take, in this order, each with a throwaway Gateway** (as the first list in
"Hands-on tests that need Stephan's OK" says: its own `OPENCLAW_STATE_DIR`, a spare loopback port,
no model key, removed afterwards):

1. Build and open the app (`pnpm tauri dev` in `apps/desktop`), open Preferences › Agents, and choose
   Connect OpenClaw… › On this Mac. Nothing is contacted until a setup code is pasted.
2. On the throwaway Gateway, `openclaw qr --setup-code-only`; paste the code in the sheet. Watch the
   sheet's status and the Gateway's `openclaw devices list`: does a request appear, with a device id
   that starts with the code the sheet shows? Approve it (`openclaw devices approve <id>`, then
   `openclaw nodes approve <id>`). Does the sheet reach Test with six tools published
   (`openclaw nodes`)? If it stops, Details has what the Gateway said: put it into
   `openclaw_protocol.rs` and the tests that mirror it.
3. Call a tool from the Gateway's agent: the app answers that it isn't connected to a document yet,
   which shows the road works end to end. Check that a `system.run` is never approvable for it.
4. Read-only look at Tailscale on his Mac: open Connect OpenClaw… › On another computer and read the
   three checks; compare with `tailscale status --json` in Terminal.
5. With Tailscale Serve on a second machine's throwaway Gateway, the whole road; then his real agent
   once, with the prompt of step 4, to see what it does and whether it can scope the tools to one
   agent.
6. From a network that blocks Tailscale, the words `Health` gives.

