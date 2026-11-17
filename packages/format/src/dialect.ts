// The dialect of the file being edited (format §9.1): GitHub's, which `.md` is, or pandoc's, which
// `.qmd` and `.Rmd` are. The rules that only pandoc has (a `:::` fence, `@fig-x` and `[@a; @b]`,
// `^x^`) apply to a pandoc file and not to a `.md`, where those characters are text. A caller names
// the dialect in the edit's context; the library holds it while the edit is made, so that an edit
// that calls another keeps its dialect, and the default is GitHub's.

/** The dialects of Markdown that the library tells apart. */
export type MarkdownDialect = 'gfm' | 'pandoc';

/** The dialect of a file by its name or path: pandoc's for `.qmd` and `.Rmd`, else GitHub's. */
export function dialectOfName(name: string): MarkdownDialect {
  return /\.(?:qmd|rmd)$/i.test(name) ? 'pandoc' : 'gfm';
}

let current: MarkdownDialect = 'gfm';

/** Whether the edit under way is in a file of the pandoc dialect. */
export function isPandoc(): boolean {
  return current === 'pandoc';
}

/** Runs `run` in `dialect`; where it is undefined, the dialect of the edit that called stays. */
export function withDialect<T>(dialect: MarkdownDialect | undefined, run: () => T): T {
  if (dialect === undefined || dialect === current) return run();
  const before = current;
  current = dialect;
  try {
    return run();
  } finally {
    current = before;
  }
}
