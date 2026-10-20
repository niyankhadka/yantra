# Getting help

## Read first

- [README](README.md): install, quick start, CLI, MCP server and Python SDK.
- [`docs/authoring.md`](docs/authoring.md): diagrams, budgets and every validation code.
- [`docs/pages.md`](docs/pages.md): answer pages and charts.
- [`docs/import.md`](docs/import.md) and [`docs/mermaid.md`](docs/mermaid.md): imports.
- [`python/README.md`](python/README.md): the Python SDK.

Most problems show up in `yantra validate <file.json>`: each finding has a stable code, and
`docs/authoring.md` (or `docs/pages.md` for pages) says how to fix it.

## Ask a question

Use [GitHub Discussions](https://github.com/niyankhadka/yantra/discussions) when it is
enabled for the repository; otherwise open an
[issue](https://github.com/niyankhadka/yantra/issues/new/choose).

## Report a bug or request a feature

Open an [issue](https://github.com/niyankhadka/yantra/issues/new/choose) with the bug report
or feature request template. Include:

- the Yantra version (`version` in `package.json`) and your Node.js and operating system
  versions;
- the command or MCP tool call you ran and its full output;
- the smallest payload, page or Mermaid / PlantUML / draw.io / Visio file that shows the
  problem, with anything confidential removed;
- a screenshot (`yantra screenshot <file>`) when the problem is visual.

## Security

Do not report vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
