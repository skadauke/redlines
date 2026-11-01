// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import page from '../../install.html?raw';
import { askQuestion } from './question.ts';

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
});
