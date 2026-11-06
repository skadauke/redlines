// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import page from '../../install.html?raw';
import { askQuestion, QUIT_FIRST, QUIT_FIRST_EVENT } from './question.ts';

/** The question's page, as install.html has it, with an answer that records what it is given. */
function question() {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  const answer = vi.fn<(install: boolean) => void>();
  askQuestion(doc, answer);
  const button = (name: string) => {
    const found = doc.querySelector<HTMLButtonElement>(`.rl-question-${name}`);
    if (!found) throw new Error(`install.html has no ${name} button`);
    return found;
  };
  const press = (key: string) =>
    doc.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { doc, answer, install: button('install'), notNow: button('not-now'), press };
}

describe('the install question', () => {
  it('asks one line, with Not Now and then Install', () => {
    const { doc } = question();
    expect(doc.querySelector('.rl-question-text')?.textContent?.trim()).toBe(
      'Install Redlines in your Applications folder?',
    );
    const labels = [...doc.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Not Now', 'Install']);
  });

  it('answers Install from its button, and says it is installing', () => {
    const { answer, install, notNow } = question();
    install.click();
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
    expect(install.textContent).toBe('Installing…');
    expect(install.disabled && notNow.disabled).toBe(true);
  });

  it('answers Not Now from its button', () => {
    const { answer, install } = question();
    question();
    const second = question();
    second.notNow.click();
    expect(second.answer).toHaveBeenCalledExactlyOnceWith(false);
    expect(answer).not.toHaveBeenCalled();
    expect(install.textContent).toBe('Install');
  });

  it('takes Return for Install, wherever the focus is', () => {
    const { answer, notNow, press } = question();
    notNow.focus();
    press('Enter');
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('takes Escape for Not Now', () => {
    const { answer, press } = question();
    press('Escape');
    expect(answer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('answers once: the first answer counts', () => {
    const { answer, install, notNow, press } = question();
    press('Escape');
    install.click();
    notNow.click();
    press('Enter');
    expect(answer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('leaves other keys alone', () => {
    const { answer, press } = question();
    press('a');
    press('Tab');
    expect(answer).not.toHaveBeenCalled();
  });

  describe('when the Redlines it would replace is open', () => {
    const quitFirst = (doc: Document) => doc.dispatchEvent(new CustomEvent(QUIT_FIRST_EVENT));

    it('asks again, in a plain line and the same two buttons', () => {
      const { doc, answer, install, notNow } = question();
      install.click();
      quitFirst(doc);
      expect(doc.querySelector('.rl-question-text')?.textContent).toBe(QUIT_FIRST.title);
      expect(install.textContent).toBe(QUIT_FIRST.install);
      expect(notNow.textContent).toBe('Not Now');
      expect(install.disabled || notNow.disabled).toBe(false);
      install.click();
      expect(answer).toHaveBeenCalledTimes(2);
      expect(answer).toHaveBeenLastCalledWith(true);
      expect(install.textContent).toBe('Installing…');
    });

    it('takes Not Now, Return and Escape as before', () => {
      const first = question();
      first.install.click();
      quitFirst(first.doc);
      first.press('Escape');
      expect(first.answer).toHaveBeenLastCalledWith(false);
      const second = question();
      second.install.click();
      quitFirst(second.doc);
      second.press('Enter');
      expect(second.answer).toHaveBeenLastCalledWith(true);
    });

    it('is ignored unless Install was pressed, and answers once more at most', () => {
      const early = question();
      quitFirst(early.doc);
      expect(early.install.textContent).toBe('Install');
      const declined = question();
      declined.notNow.click();
      quitFirst(declined.doc);
      expect(declined.answer).toHaveBeenCalledExactlyOnceWith(false);
      expect(declined.install.disabled).toBe(true);
      const { doc, answer, install } = question();
      install.click();
      quitFirst(doc);
      install.click();
      quitFirst(doc);
      expect(answer).toHaveBeenCalledTimes(2);
      expect(install.textContent).toBe('Installing…');
    });
  });
});
