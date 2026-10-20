import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/** `files` entry as a matcher: a folder, a file or a one-level glob (`docs/*.md`). */
const glob = (f) => new RegExp(`^${f.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`);
/** True when `files` ships this repo-relative path. */
const shipped = (rel) =>
  pkg.files.some((f) => (f.includes('*') ? glob(f).test(rel) : rel === f.replace(/\/$/, '') || rel.startsWith(f.endsWith('/') ? f : `${f}/`)));

test('package.json is publishable', () => {
  assert.equal(pkg.private, undefined, 'private packages cannot be published');
  assert.equal(pkg.name, '@niyankhadka/yantra');
  assert.equal(pkg.bin.yantra, './bin/yantra.js');
  assert.ok(pkg.keywords.length >= 5);
  assert.match(pkg.scripts.prepack, /npm run build/, 'prepack builds the viewer into dist/');
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'no runtime dependencies');
  assert.ok(pkg.devDependencies.vite);
  assert.match(read('bin/yantra.js'), /^#!\/usr\/bin\/env node/);
});

test('files covers everything the builder, CLI and MCP server read at run time', () => {
  const build = read('lib/build.js');
  const sources = JSON.parse(/const SOURCES = (\[[^\]]*\])/.exec(build)[1].replace(/'/g, '"'));
  const needed = [
    'bin/yantra.js', 'lib/build.js', 'lib/browser.js', 'mcp/server.js', 'dist/index.html',
    'src/assets/logo-light.svg', 'src/core/import.js', 'src/core/drawio.js', 'src/core/plantuml.js',
    'schemas/yantra-payload.schema.json', 'schemas/yantra-page.schema.json',
    'docs/authoring.md', 'docs/pages.md', 'examples/oauth-login.json', 'examples/drawio/order-platform.drawio',
    ...sources
  ];
  assert.match(build, /path\.join\(ROOT, 'dist'\)/);
  for (const rel of needed) assert.ok(shipped(rel), `${rel} is not in package.json files`);
  for (const rel of ['tests/core.test.js', 'python/pyproject.toml', 'node_modules/vite/package.json', 'docs/images/walkthrough.png'])
    assert.ok(!shipped(rel), `${rel} should not ship`);
  // Every relative module imported by shipped code is shipped too
  for (const entry of ['bin/yantra.js', 'mcp/server.js', 'lib/build.js']) {
    for (const m of read(entry).matchAll(/from '(\.\.?\/[^']+)'/g)) {
      const rel = path.relative(ROOT, path.resolve(ROOT, path.dirname(entry), m[1])).replace(/\\/g, '/');
      assert.ok(shipped(rel), `${entry} imports ${rel}, which is not shipped`);
    }
  }
});

test('npm pack lists the expected files', { timeout: 120000 }, () => {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf-8', shell: true });
  if (res.status !== 0) return; // npm unavailable: covered by the static check above
  const files = JSON.parse(res.stdout)[0].files.map((f) => f.path.replace(/\\/g, '/'));
  for (const f of ['bin/yantra.js', 'lib/build.js', 'mcp/server.js', 'src/core/lint.js', 'schemas/yantra-payload.schema.json', 'README.md', 'LICENSE', 'CHANGELOG.md'])
    assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /^(tests|python|\.github|\.claude|\.agents|node_modules|docs\/images)\//.test(f)), 'dev-only folders are not packed');
});

test('release workflow runs only on version tags and publishes after the tests', () => {
  const yml = read('.github/workflows/release.yml').replace(/\r\n/g, '\n');
  const on = /\non:\n([\s\S]*?)\n\S/.exec(yml)[1];
  assert.match(on, /tags:\s*\n\s*- 'v\*'/);
  assert.doesNotMatch(on, /branches|pull_request|workflow_dispatch/);
  assert.match(yml, /npm@latest stage publish --provenance --access public/, 'npm releases are staged through trusted publishing');
  assert.doesNotMatch(yml, /NPM_TOKEN|NODE_AUTH_TOKEN/, 'no long-lived npm token');
  assert.match(yml, /pypa\/gh-action-pypi-publish/);
  assert.match(yml, /id-token: write/);
  assert.equal((yml.match(/needs: test/g) || []).length, 2);
});

test('project docs exist and the changelog keeps an Unreleased section', () => {
  for (const f of ['CONTRIBUTING.md', 'SECURITY.md', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml'])
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  const log = read('CHANGELOG.md');
  assert.match(log, /^## \[Unreleased\]/m);
  assert.match(log, new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm'));
  assert.match(read('python/pyproject.toml'), new RegExp(`^version = "${pkg.version}"`, 'm'));
});
