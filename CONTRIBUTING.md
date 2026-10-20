# Contributing to Yantra

Thanks for helping. Bug reports, examples, importer fixes and documentation are all welcome.
Please open an issue before a large change so we can agree on the approach first.

## Setup

You need Node.js 18 or later; Python 3.9 or later only for the Python SDK.

```bash
git clone https://github.com/niyankhadka/yantra.git
cd yantra
npm install
npm run dev                         # live viewer at http://localhost:3000
pip install -e python/              # optional: the Python SDK, editable
```

`AGENTS.md` describes the layout of the repository and `docs/architecture.md` the engine.
Geometry logic lives only in `src/core/` (pure modules, no DOM); the browser viewer, the CLI,
the MCP server and the tests all call it.

## Tests

```bash
npm test                                          # Node suite (node --test)
python -m unittest discover -s python/tests -v    # Python SDK
npm run build                                     # viewer bundle builds
```

Both suites must pass on every pull request; CI runs them on Linux and Windows with
Node 18, 20 and 22 and Python 3.9 and 3.12.

## Rules that the tests enforce

- **Examples validate with zero warnings.** Every file in `examples/` must pass
  `node bin/yantra.js validate <file>` with no errors and no warnings; import samples in
  `examples/mermaid/`, `examples/drawio/` and `examples/plantuml/` must import and validate
  cleanly too. Look at a screenshot (`node bin/yantra.js screenshot <file>`) before adding one.
- **Skill copies match.** `.claude/skills/yantra/SKILL.md` and `.agents/skills/yantra/SKILL.md`
  must be identical; edit one and copy it over the other.
- **Card metrics match.** `CARD` in `src/core/layout.js` must agree with `src/styles/diagram.css`.
- **Packaging.** Anything the CLI reads at run time must be covered by `files` in
  `package.json` (a test checks the paths `lib/build.js` and the MCP server use).
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
publishes to npm and PyPI.

## Reporting security issues

Please do not open a public issue; follow [`SECURITY.md`](SECURITY.md).
