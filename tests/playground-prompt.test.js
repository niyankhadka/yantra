// The playground's "Copy prompt": instructions (chat/prompt.md) plus what the editor holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt, PLACEHOLDER, MAX_FINDINGS, COMPACT_ABOVE, LARGE_PROMPT } from '../playground/prompt.js';
import { lint } from '../src/core/lint.js';
import { ROOT } from '../lib/build.js';

const INSTRUCTIONS = fs.readFileSync(path.join(ROOT, 'chat', 'prompt.md'), 'utf-8');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', `${name}.json`), 'utf-8'));
const smallest = JSON.parse(/```json\n([\s\S]*?)```/.exec(INSTRUCTIONS)[1]);

test('empty editor: the instructions and a request line with the placeholder', () => {
  const p = buildPrompt({ instructions: INSTRUCTIONS, text: '  \n' });
  assert.equal(p.mode, 'new');
  assert.ok(p.text.startsWith(INSTRUCTIONS.trim()), 'chat/prompt.md comes first, unchanged');
  assert.ok(p.text.trimEnd().endsWith(`Describe what you want: ${PLACEHOLDER}`));
  assert.equal(p.large, false);
  const asked = buildPrompt({ instructions: INSTRUCTIONS, request: '  Show how OAuth login works  ' });
  assert.ok(asked.text.trimEnd().endsWith('Describe what you want: Show how OAuth login works'));
  assert.ok(!asked.text.includes(PLACEHOLDER));
});

test('valid diagram: the JSON in a fence and a change request; pages are called answer pages', () => {
  const p = buildPrompt({ instructions: INSTRUCTIONS, text: JSON.stringify(smallest), value: smallest, report: lint(smallest), request: 'add a refund step' });
  assert.equal(p.mode, 'edit');
  assert.equal(p.kind, 'diagram');
  assert.equal(p.findings, 0);
  assert.ok(p.text.includes(`## My current diagram\n\n\`\`\`json\n${JSON.stringify(smallest, null, 2)}\n\`\`\``));
  assert.match(p.text, /Change this diagram: add a refund step\n\nReply with the full updated JSON/);
  const page = { kind: 'page', meta: { title: 'Q' }, answer: { headline: 'Yes.' }, blocks: [{ type: 'text', body: 'Because.' }] };
  const pp = buildPrompt({ instructions: INSTRUCTIONS, value: page, report: lint(page) });
  assert.equal(pp.kind, 'page');
  assert.match(pp.text, /## My current answer page/);
  assert.match(pp.text, new RegExp(`Change this answer page: ${PLACEHOLDER}`));
});

test('findings: listed with code, location and message, then a fix request', () => {
  const broken = structuredClone(smallest);
  broken.edges[0].target = 'nowhere';
  const report = lint(broken);
  assert.ok(report.errors.length > 0);
  const p = buildPrompt({ instructions: INSTRUCTIONS, value: broken, report });
  assert.equal(p.mode, 'fix');
  assert.equal(p.findings, report.errors.length + report.warnings.length);
  const f = report.errors[0];
  assert.ok(p.text.includes(`- error \`${f.code}\``), 'the code is quoted');
  assert.ok(p.text.includes(f.message.replace(/\s+/g, ' ').trim()));
  assert.match(p.text, /## Validation findings \(\d+ errors?/);
  assert.ok(p.text.trimEnd().endsWith('Fix these problems and return the full corrected JSON in one ```json block.'));
  const asked = buildPrompt({ instructions: INSTRUCTIONS, value: broken, report, request: 'and make it vertical' });
  assert.ok(asked.text.trimEnd().endsWith('Also: and make it vertical'));
});

test('warnings alone also ask for a fix; findings are capped', () => {
  const report = { errors: [], warnings: Array.from({ length: MAX_FINDINGS + 7 }, (_, i) => ({ code: 'layout/x', message: `w${i}`, node: `n${i}` })) };
  const p = buildPrompt({ instructions: INSTRUCTIONS, value: smallest, report });
  assert.equal(p.mode, 'fix');
  assert.match(p.text, /\(27 warnings\)/);
  assert.equal((p.text.match(/^- warning /gm) || []).length, MAX_FINDINGS);
  assert.match(p.text, /- \.\.\.and 7 more\./);
  assert.match(p.text, /- warning `layout\/x` \(node n0\): w0/);
});

test('text that is not JSON is copied as it is, with the syntax error', () => {
  const p = buildPrompt({ instructions: INSTRUCTIONS, text: '{ "meta": { "title": "x", }', jsonError: new SyntaxError('Unexpected token }') });
  assert.equal(p.mode, 'fix');
  assert.ok(p.text.includes('{ "meta": { "title": "x", }'));
  assert.match(p.text, /- error `json\/syntax`: Not valid JSON: Unexpected token \}/);
});

test('large JSON is compacted and flagged; instructions only drops the JSON', () => {
  const big = example('cloud-architecture');
  big.meta.description = 'x'.repeat(COMPACT_ABOVE);
  const p = buildPrompt({ instructions: INSTRUCTIONS, value: big, report: { errors: [], warnings: [] } });
  assert.equal(p.compact, true);
  assert.ok(p.text.includes(JSON.stringify(big)), 'the whole JSON is still copied');
  big.meta.description = 'x'.repeat(LARGE_PROMPT);
  assert.equal(buildPrompt({ instructions: INSTRUCTIONS, value: big, report: { errors: [], warnings: [] } }).large, true);
  const only = buildPrompt({ instructions: INSTRUCTIONS, value: big, instructionsOnly: true });
  assert.equal(only.text, `${INSTRUCTIONS.trim()}\n`);
  assert.equal(only.large, false);
});

test('backticks inside the JSON do not close the fence', () => {
  const d = structuredClone(smallest);
  d.meta.description = 'Use ```code``` here';
  const p = buildPrompt({ instructions: INSTRUCTIONS, value: d, report: { errors: [], warnings: [] } });
  assert.match(p.text, /````json\n/);
});
