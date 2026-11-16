// The handles of the agents (Preferences › Agents, #558). An agent's display name is its handle with
// a capital: @ada is shown as "Ada" in the picker, in Ask and in Preferences, and `@` and the handle
// names it in a mention. The handle is one thing; there is no display name apart from it. What
// identifies the agent for the host (its id, as `claude` or `codex`) never changes, so the files an
// agent already wrote in keep their author.

/** The handles the agents Redlines runs itself have until the person changes them. */
export const DEFAULT_HANDLES: Readonly<Record<string, string>> = {
  claude: 'claude',
  codex: 'codex',
};

/** The longest handle. */
export const MAX_HANDLE = 24;

/** Lowercase letters, digits and hyphens, not starting or ending in a hyphen. */
export function isHandle(text: string): boolean {
  return text.length <= MAX_HANDLE && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
}

/** The handle an agent has: the person's, when it is a handle; else the default, else its id. */
export function handleOf(
  id: string,
  handles: Readonly<Record<string, string>> | undefined,
): string {
  const chosen = handles?.[id];
  if (chosen !== undefined && isHandle(chosen)) return chosen;
  return DEFAULT_HANDLES[id] ?? id;
}

/** The name an agent is shown by: its handle, capitalized. */
export function displayName(handle: string): string {
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

/**
 * Why `text` can't be the handle of agent `id`, as a line to show, or null when it can. `taken` is
 * the handle each agent has now.
 */
export function handleProblem(
  text: string,
  id: string,
  taken: Readonly<Record<string, string>>,
): string | null {
  if (text === '') return 'A handle needs a letter or a digit.';
  if (text.length > MAX_HANDLE) return `A handle has at most ${MAX_HANDLE} characters.`;
  if (!isHandle(text)) {
    return 'A handle has lowercase letters, digits and hyphens, and no hyphen at either end.';
  }
  for (const [other, handle] of Object.entries(taken)) {
    if (other !== id && handle === text) return `Another agent is @${text}.`;
  }
  return null;
}
