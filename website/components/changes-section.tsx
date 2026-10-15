import { changes } from '../lib/site';
import { AgentDemo } from './agent-demo';
import { Part } from './section';

export function ChangesSection() {
  return (
    <Part id="changes" title={changes.title} body={changes.body} points={changes.points}>
      <AgentDemo />
    </Part>
  );
}
