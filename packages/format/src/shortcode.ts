// Emoji shortcodes (#312), the `:name:` that GitHub and Slack read as an emoji. The format keeps a
// marker out of one, and the editor draws the ones it knows as their emoji; both read a shortcode
// by this one pattern. The names are gemoji's: lowercase letters, digits, `_`, `-` and `+`.

/**
 * What a shortcode looks like: lowercase letters and digits in words parted by one `_` or `-`, at
 * least two characters with a letter among them, so that `:30:` of a time is none, and `:_x_:` is
 * none; and the six names of one letter (`:x:`), `+1`, `-1`, `100` and `1234`, which have none. Which of these GitHub knows is for the emoji plugin
 * to say: the format only keeps a marker out of what could be one.
 */
export const SHORTCODE_SOURCE =
  ':(?:[abmovx]|\\+1|-1|100|1234|(?=[a-z0-9_-]{2,}:)(?=[0-9_-]*[a-z])[a-z0-9]+(?:[_-][a-z0-9]+)*):';

const AT_START = new RegExp(`^${SHORTCODE_SOURCE}`);

/** The shortcode that `text` starts with, or null. */
export function shortcodeAt(text: string): string | null {
  return AT_START.exec(text)?.[0] ?? null;
}
