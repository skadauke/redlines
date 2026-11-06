// The install question's buttons and keys (install.html).

/**
 * What the app asks instead, when the Redlines it would replace is open (install.rs, QUIT_FIRST;
 * a test keeps the two the same). The app tells the page by dispatching this event on the document.
 */
export const QUIT_FIRST_EVENT = 'redlines:quit-first';
export const QUIT_FIRST = {
  title: 'Redlines is open. Quit it to install?',
  install: 'Quit and Install',
};

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
  const text = root.querySelector('.rl-question-text');
  let answered = false;
  let quitAsked = false;
  const give = (yes: boolean) => {
    if (answered) return;
    answered = true;
    install.disabled = true;
    notNow.disabled = true;
    // Copying takes a moment before the installed copy opens.
    if (yes) install.textContent = 'Installing…';
    answer(yes);
  };
  // Only after an Install: Not Now has ended the question.
  root.addEventListener(QUIT_FIRST_EVENT, () => {
    if (!answered || quitAsked || install.textContent !== 'Installing…') return;
    answered = false;
    quitAsked = true;
    if (text) text.textContent = QUIT_FIRST.title;
    install.textContent = QUIT_FIRST.install;
    install.disabled = false;
    notNow.disabled = false;
    install.focus();
  });
  install.addEventListener('click', () => give(true));
  notNow.addEventListener('click', () => give(false));
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    // Return is Install even with Not Now focused, so the focused button mustn't take it too.
    event.preventDefault();
    give(event.key === 'Enter');
  });
}
