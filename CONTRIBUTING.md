# Contributing to Yantra

Thanks for helping. Bug reports, examples, importer fixes and documentation are all welcome.
Please open an issue before a large change so we can agree on the approach first.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). For questions, see
[SUPPORT.md](SUPPORT.md); the user documentation is at https://yantra.nbk.com.np/docs/.

## Setup

You need Node.js 20.19 or later (22.12 or later on Node 22); Python 3.9 or later only for the Python SDK.

```bash
git clone https://github.com/niyankhadka/yantra.git
cd yantra
npm install
npm run dev                         # live viewer at http://localhost:3000
pip install -e python/              # optional: the Python SDK, editable
```

[`AGENTS.md`](AGENTS.md) describes the repository for agents and
[`docs/architecture.md`](docs/architecture.md) the engine. Geometry logic lives only in
`src/core/` (pure modules, no DOM); the browser viewer, the CLI, the MCP server and the tests
all call it.

## Repository layout

```
bin/yantra.js        CLI
mcp/                 MCP server: stdio (server.js), Streamable HTTP (http.js), tools (tools.js)
lib/                 Node only: standalone HTML builder, headless screenshots, yantra init
skills/yantra/       Portable agent skill that yantra init installs in other projects
playground/          Browser playground for JSON from AI chats
site/                Website (yantra.nbk.com.np): landing page, docs build, guides
chat/                Chat packs: copyable prompt, Claude.ai skill, custom GPT instructions
src/core/            Shared engine: model, layout, routing, lint, pages, charts, importers, i18n
src/app/             Browser viewer
src/styles/          Viewer CSS
src/assets/          Logos
schemas/             JSON Schemas for diagrams and answer pages
examples/            Example diagrams and pages, and import samples
docs/                Reference docs (also rendered on the website); images/ holds README pictures
python/              Python SDK (niyankhadka-yantra)
tests/               Node test suite
```

## Tests

```bash
npm test                                          # Node suite (node --test)
python -m unittest discover -s python/tests -v    # Python SDK
npm run build                                     # viewer bundle builds
npm run build:site                                # website and playground build
```

Both suites must pass on every pull request. CI ([`ci.yml`](.github/workflows/ci.yml)) runs
the Node suite on Node 20, 22 and 24 on Linux and Node 24 on Windows, validates and builds
every example, and runs the Python SDK tests on Python 3.9 and 3.12. Some tests drive a
headless Chrome, Edge or Chromium and are skipped when none is installed (`YANTRA_BROWSER`
points to one).

## Rules that the tests enforce

- **Examples validate with zero warnings.** Every file in `examples/` must pass
  `node bin/yantra.js validate <file>` with no errors and no warnings; import samples in
  `examples/mermaid/`, `examples/drawio/`, `examples/plantuml/` and `examples/visio/` must import and validate
  cleanly too. Look at a screenshot (`node bin/yantra.js screenshot <file>`) before adding one.
- **Skill copies match.** `.claude/skills/yantra/SKILL.md` and `.agents/skills/yantra/SKILL.md`
  must be identical; edit one and copy it over the other.
- **Card metrics match.** `CARD` in `src/core/layout.js` must agree with `src/styles/diagram.css`.
- **Packaging.** Anything the CLI reads at run time must be covered by `files` in
  `package.json` (a test checks the paths `lib/build.js` and the MCP server use).
- **Interface strings are translated.** A new key in `src/core/i18n.js` needs a real
  translation in every `src/core/locales/*.js` file, with the same `{placeholders}`.
- Schema and docs changes are additive: new fields are optional, and existing payloads keep
  validating.

## Commits and pull requests

- Commit subjects are short and imperative, at most about 60 characters, with no trailing
  full stop: `Add PlantUML activity import`, `Fix label overlap in TB layouts`.
- Add a body only when the reason for a change is not obvious from the diff.
- Keep each pull request to one topic, add tests for new behaviour, and add a line to the
  `Unreleased` section of `CHANGELOG.md` for anything users will notice.

## Releases

Maintainers tag `vX.Y.Z` on `main` after updating the version in `package.json`,
`python/pyproject.toml` and `python/yantra/__init__.py` and moving the `Unreleased` notes
under the new version in `CHANGELOG.md`. The `Release` workflow then runs the tests and
publishes through trusted publishing, with no stored tokens:

- **npm:** the version is staged; approve it on the package page on npmjs.com (or
  `npm stage approve <id>`) with two-factor authentication to make it live.
- **PyPI:** the job waits on the `pypi` environment; approve it under
  **Review deployments** in the Actions run.

## Reporting security issues

Please do not open a public issue; follow [`SECURITY.md`](SECURITY.md).
