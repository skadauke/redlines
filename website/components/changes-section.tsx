import { embedFiles } from '../lib/embed';
import { changes } from '../lib/site';
import { DesignFallback } from './demo-fallback';
import { DemoPanel } from './demo-panel';
import { Part } from './section';

export function ChangesSection() {
  return (
    <Part id="changes" title={changes.title} body={changes.body} points={changes.points}>
      <DemoPanel demo="design" embed={embedFiles()}>
        <DesignFallback />
      </DemoPanel>
    </Part>
  );
}
