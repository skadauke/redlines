// Handles for the people who edit (format §2.4 and §5.3).

// Words YAML 1.1 reads as booleans or null, and the author nobody recorded (format §2.4).
const RESERVED_HANDLES = new Set('y n yes no on off true false null unknown'.split(' '));

/**
 * A handle from the email's local part, else from the name (format §5.3): lowercase letters,
 * digits, `-` and `_`, starting with a letter. Accents are dropped; any other run of characters
 * becomes `-`. Falls back to `me` when neither gives a usable handle.
 */
export function deriveHandle(name: string, email?: string | null): string {
  const local = email?.split('@')[0] ?? '';
  return toHandle(local) || toHandle(name) || 'me';
}

export function toHandle(text: string): string {
  const handle = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/[-_]+$/, '');
  return RESERVED_HANDLES.has(handle) ? '' : handle;
}
