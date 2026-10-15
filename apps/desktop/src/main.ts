import { createEditor } from '@redlines/editor';
import './styles.css';

const sample = `# Redlines

A Markdown editor that shows every change. For now this is plain CodeMirror, so you see the
Markdown source.

## Tracked changes

Changes are saved in the file as HTML comments, which other Markdown tools hide:

We will ship the <!--ins k3x9 ada 2026-10-13T22:30Z-->new <!--/k3x9-->importer in <!--sub p7qd bo 2026-10-13T22:31Z March-->April<!--/p7qd-->.

GitHub shows this as "We will ship the new importer in April."
`;

const parent = document.querySelector<HTMLElement>('#editor');
if (!parent) throw new Error('index.html has no #editor element');
createEditor(parent, { doc: sample });
