import type { DemoName } from './api.ts';
import designNote from './docs/design-note.md?raw';
import launchPlan from './docs/launch-plan.md?raw';

/** The documents of the demos, written as the format writes them. */
export const DOCS: Readonly<Record<DemoName, { file: string; text: string }>> = {
  plan: { file: 'plan.md', text: launchPlan },
  design: { file: 'design.md', text: designNote },
};
