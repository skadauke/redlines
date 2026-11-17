// The agent behind "Describe with <agent>" (issue #553): the request an Alt Text bubble sends.
//
// Who writes it: the default agent (Preferences' choice, as Ask's picker shows it) when it can look at
// pictures; otherwise the first agent that is ready and can, named in the button; with none that can,
// the button is grayed and says so. Agents with no toolbox (OpenClaw) never are asked.
//
// How the agent sees the image, ruled for least permission (the design of this request):
//  - It is shown the one picture through `view_image`, an MCP tool that takes no argument, so there is
//    no path for it to name; the host reads that file (`readImage`: the app reads only inside a folder
//    its sidebars show, only PNG, JPEG, GIF or WebP, at most 3.5 MB) before the agent is started, and
//    hands the bytes over as an image content block.
//  - The request is at scope "document" with the toolbox restricted to `view_image` and `status`
//    (`DESCRIBE_TOOLS`): the agent gets no tool that reads the document or writes anything, and a
//    provider gives a "This document" run no file tools of its own (Claude: `--tools ''`). So no file
//    access is granted at all, not even read-only access to the one file, and the question of the
//    folder is never asked.
//  - What it writes goes into the bubble's field, and nowhere else, until the person saves.

import { answerMcp, altTextPrompt, DESCRIBE_TOOLS } from '@redlines/agent-tools';
import type { ImageBytes, ToolContext } from '@redlines/agent-tools';
import type { Author } from '@redlines/editor';
import type { Person } from '@redlines/format';
import type { AgentInfo, AgentRequest, HostAgents, ToolLines } from '@redlines/plugin-api';
import { agentHandle } from '../runs.ts';
import type { AltDescriber, AltImage, AltWriter } from './index.ts';

export interface AltAgentDeps {
  agents: HostAgents;
  author: Author;
  document: {
    path(): string | null;
    /** Bumped whenever another document replaces this one. */
    generation(): number;
  };
  /**
   * The agent a request goes to when the person has chosen none, by id: Preferences' choice.
   * Default: the first agent found that is signed in.
   */
  defaultAgent?: () => string | undefined;
  /**
   * Reads the image `src`, as the document writes it, for an agent to look at. It rejects with a
   * line for the person when the file may not be read, isn't a picture an agent takes, or is too
   * big; the host decides what may be read.
   */
  readImage(src: string): Promise<ImageBytes>;
}

const CHANGED = 'The document changed under this request, so it has stopped.';
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The words an answer is cleaned of: quotation marks around it, and a leading "Alt text:". */
export function cleanedAlt(answer: string): string {
  const one = answer
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^alt text:\s*/i, '');
  const unquoted = /^(["“'])(.*)(["”'])$/.exec(one);
  return (unquoted ? unquoted[2]! : one).trim();
}

/** The agent that writes, and whether it can: null where no agent is set up. */
export function chooseWriter(
  agents: readonly AgentInfo[],
  preferred: string | undefined,
): { agent: AgentInfo; unavailable?: string } | null {
  const usable = agents.filter((agent) => agent.toolbox !== false && agent.state.found);
  const ready = (agent: AgentInfo) => agent.state.found && agent.state.signedIn;
  const chosen = usable.find((agent) => agent.id === preferred) ?? usable.find(ready) ?? usable[0];
  if (!chosen) return null;
  // The default agent can't look at pictures: another that can does, and is named.
  const sees = (agent: AgentInfo) => agent.seesImages === true && agent.readLimit !== 'machine';
  const writer = sees(chosen) ? chosen : (usable.find((a) => ready(a) && sees(a)) ?? chosen);
  if (!sees(writer)) {
    return {
      agent: writer,
      unavailable:
        writer.readLimit === 'machine' && writer.seesImages === true
          ? `${writer.name} can read more than this image on this Mac, so it isn’t asked to describe one.`
          : `${writer.name} can’t look at pictures here.`,
    };
  }
  if (writer.state.found && !writer.state.signedIn) {
    const help = writer.state.help ?? '';
    return {
      agent: writer,
      unavailable: `${writer.name} isn’t signed in.${help ? ` ${help}` : ''}`,
    };
  }
  return { agent: writer };
}

/** An agent that writes the alt text of an image: what an Alt Text bubble asks. */
export function createAltDescriber(deps: AltAgentDeps): AltDescriber {
  let count = 0;
  const writer = async () => chooseWriter(await deps.agents.list(), deps.defaultAgent?.());

  return {
    async who(): Promise<AltWriter | null> {
      const found = await writer();
      if (!found) return null;
      return {
        name: found.agent.name,
        ...(found.unavailable === undefined ? {} : { unavailable: found.unavailable }),
      };
    },

    async describe(image: AltImage, signal: AbortSignal): Promise<string> {
      const found = await writer();
      if (!found)
        throw new Error('No agent is set up. Install Claude Code, and sign in, to describe.');
      if (found.unavailable !== undefined) throw new Error(found.unavailable);
      const { agent } = found;
      // The picture is read before the agent starts: a file that can't be read says so, in words for
      // the person, and no agent is run for it.
      const generation = deps.document.generation();
      const picture = await deps.readImage(image.src);
      if (signal.aborted) throw new Error('Stopped.');
      if (deps.document.generation() !== generation) throw new Error(CHANGED);
      const me = deps.author.handle;
      const author: Person = {
        handle: agentHandle(agent.id, me),
        name: agent.name,
        agent: true,
        for: me,
      };
      const ctx: ToolContext = {
        doc: {
          read() {
            throw new Error('This request has no document to read.');
          },
          write() {
            throw new Error('This request writes nothing.');
          },
        },
        author,
        thread: '',
        now: () => new Date(),
        requestedBy: me,
        onStatus: () => {},
        onReply: () => {},
        image: { read: () => Promise.resolve(picture) },
      };
      const answer = answerMcp(ctx, { only: DESCRIBE_TOOLS });
      const tools: ToolLines = async (line) => {
        if (deps.document.generation() !== generation) return refuse(line);
        return answer(line);
      };
      const path = deps.document.path();
      const request: AgentRequest = {
        prompt: 'Write the alt text for the image.',
        systemPrompt: altTextPrompt({
          documentName: path === null ? 'Untitled' : basename(path),
          current: image.alt,
        }),
        thread: `alt-${++count}`,
        ...(path === null ? {} : { documentPath: path }),
        scope: 'document',
        author: { handle: author.handle, name: author.name, for: me },
      };
      const events = deps.agents.run(agent.id, request, tools, signal)[Symbol.asyncIterator]();
      try {
        for (;;) {
          const next = await events.next();
          if (signal.aborted) throw new Error('Stopped.');
          if (next.done === true) throw new Error(`${agent.name} ended without an answer.`);
          const event = next.value;
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'done') {
            const text = cleanedAlt(event.finalText ?? '');
            if (text === '') throw new Error(`${agent.name} ended with nothing to say.`);
            if (deps.document.generation() !== generation) throw new Error(CHANGED);
            return text;
          }
        }
      } catch (error) {
        throw new Error(reasonOf(error), { cause: error });
      } finally {
        // Let go of the agent, which closes its relay once it is let go of.
        void events.return?.(undefined).catch(() => {});
      }
    },
  };
}

/** A JSON-RPC error for a refused line, or null for a notification, which has no one to answer. */
function refuse(line: string): string | null {
  let id: unknown = null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      if (!('id' in parsed)) return null;
      id = (parsed as { id?: unknown }).id;
    }
  } catch {
    // Not JSON: there is no id to answer to.
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message: CHANGED },
  });
}
