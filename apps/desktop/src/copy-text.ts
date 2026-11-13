// Puts text on the clipboard, for a button the person pressed (Preferences › Agents, Copy beside the
// command that installs an agent).

/**
 * Copies `text`. The clipboard API where the page may use it; where WebKit refuses it, the old way
 * of selecting the text in a field and copying, which a button's press allows. Rejects when neither
 * worked.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Refused, or there is none: the old way.
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.opacity = '0';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('Couldn’t copy.');
  } finally {
    field.remove();
  }
}
