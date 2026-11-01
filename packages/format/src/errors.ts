/** An edit that can't be made. Its message is shown to people and agents as it is. */
export class EditError extends Error {
  override name = 'EditError';
}
