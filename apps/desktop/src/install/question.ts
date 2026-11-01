// The install question's buttons and keys (install.html).

/**
 * Wires the question in `root`: Install and Not Now, Return for Install and Escape for Not Now, as
 * in the system's own alerts. Calls `answer` once, with the first answer.
 */
export function askQuestion(root: Document, answer: (install: boolean) => void): void {
  const button = (name: string) => {
    const found = root.querySelector<HTMLButtonElement>(`.rl-question-${name}`);
    if (!found) throw new Error(`install.html has no ${name} button`);
    return found;
  };
  const install = button('install');
  const notNow = button('not-now');
  let answered = false;
  const give = (yes: boolean) => {
    if (answered) return;
    answered = true;
    install.disabled = true;
    notNow.disabled = true;
    // Copying takes a moment before the installed copy opens.
    if (yes) install.textContent = 'Installing…';
    answer(yes);
  };
  install.addEventListener('click', () => give(true));
  notNow.addEventListener('click', () => give(false));
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    // Return is Install even with Not Now focused, so the focused button mustn't take it too.
    event.preventDefault();
    give(event.key === 'Enter');
  });
}
