import { describe, expect, it } from 'vitest';
import { documentShape, ISSUES_URL, problemText, reportFor, type Problem } from './crash-report.ts';

const SECRET = 'The merger closes on Friday and nobody may know';

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: '1-1',
  kind: 'web-process',
  at: '2026-11-16T12:00:00Z',
  window: 'main',
  message: 'The web content process of window main ended.',
  trace: 'at scrollTo (app.js:1:1)\nat tick (app.js:2:2)',
  shape: null,
  doing: 'scrolling, 87% down (1 s ago)',
  memoryKb: 2_097_152,
  macos: 'macOS 15.1 (aarch64)',
  build: '0.2.0-dev (1a2b3c4)',
  ...over,
});

describe('documentShape', () => {
  it('counts sizes and marks and keeps no text', () => {
    const text = [
      `# ${SECRET}`,
      'We <!--ins k3x9-->add<!--/k3x9--> and <!--del w2rf gone--> and <!--cmt c8d2-->note<!--/c8d2-->.',
      '![alt](pic.png)',
      '| a | b |',
      '| --- | :-: |',
      '| 1 | 2 |',
    ].join('\n');
    const shape = documentShape(text);
    expect(shape).toMatchObject({ lines: 6, marks: 2, comments: 1, images: 1, tables: 1 });
    expect(shape.longestLine).toBe(Math.max(...text.split('\n').map((line) => line.length)));
    expect(shape.bytes).toBe(text.length);
    expect(JSON.stringify(shape)).not.toContain('merger');
  });

  it('says one line for an empty document', () => {
    expect(documentShape('')).toMatchObject({ bytes: 0, lines: 1, longestLine: 0 });
  });
});

describe('reportFor', () => {
  const environment = { build: '0.2.0 (abc)', macos: 'macOS 15.1' };

  it('holds the build, the system, the trace and the shape, and never the document', () => {
    const shape = documentShape(`# ${SECRET}\nmore`);
    const report = reportFor(problem({ shape }), environment, null);
    expect(report.url.startsWith(`${ISSUES_URL}?title=`)).toBe(true);
    expect(report.body).toContain('0.2.0-dev (1a2b3c4)');
    expect(report.body).toContain('macOS 15.1 (aarch64)');
    expect(report.body).toContain('at scrollTo');
    expect(report.body).toContain('Memory in use: 2048 MB');
    expect(report.body).toContain('scrolling, 87% down');
    expect(report.body).toContain(`${shape.bytes} bytes, 2 lines`);
    expect(decodeURIComponent(report.url)).not.toContain('merger');
    expect(report.body).not.toContain('merger');
  });

  it('serves a report with no failure, from the environment and the open document', () => {
    const report = reportFor(null, environment, documentShape('a\nb'));
    expect(report.body).toContain('0.2.0 (abc)');
    expect(report.body).toContain('macOS 15.1');
    expect(report.body).toContain('3 bytes, 2 lines');
  });

  it('cuts a long trace until the link fits', () => {
    const trace = Array.from({ length: 400 }, (_, i) => `at frame${i} (app.js:${i}:1)`).join('\n');
    const report = reportFor(problem({ trace }), environment, null);
    expect(report.url.length).toBeLessThanOrEqual(7000);
    expect(report.body).toContain('at frame0 ');
    expect(report.body).not.toContain('at frame399 ');
  });
});

describe('problemText', () => {
  it('says each kind in a sentence', () => {
    expect(problemText(problem())).toBe('Redlines had a problem and reloaded this window.');
    expect(problemText(problem({ kind: 'hang' }))).toContain('stopped responding');
    expect(problemText(problem({ kind: 'panic' }))).toContain('last time it ran');
    expect(problemText(problem({ kind: 'app-crash' }))).toContain('last time it ran');
    expect(problemText(problem({ kind: 'page-error' }))).toContain('still open');
  });
});
