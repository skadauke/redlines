// "Don't ask again in this document" (design: widen, alert or disable, §3.1): kept by the app for
// the file, by its path, and never in the file, so that somebody else who opens it is asked. It ends
// the question for that file on this Mac; Preferences › Editing's "Ask Again in All Documents"
// takes every one back. A document with no path yet is remembered for the window only.

const KEY = 'redlines.untracked-answers';

export interface UntrackedAnswers {
  /** Whether the person chose not to be asked for this document. */
  skipped(path: string | null): boolean;
  /** Chooses not to be asked for this document. */
  skip(path: string | null): void;
}

function stored(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Takes every answer back: the next edit that can't be tracked asks again. */
export function askAgainInAllDocuments(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

export function createUntrackedAnswers(): UntrackedAnswers {
  const session = new Set<string>();
  return {
    skipped: (path) => (path === null ? session.has('') : stored().includes(path)),
    skip(path) {
      if (path === null) {
        session.add('');
        return;
      }
      try {
        localStorage.setItem(KEY, JSON.stringify([...new Set([...stored(), path])]));
      } catch {
        session.add(path);
      }
    },
  };
}
