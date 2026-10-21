# Getting help

Where to look first, where to ask, and what to include in a bug report.

## Read first

- [Documentation](https://yantra.nbk.com.np/docs/): step-by-step guides and the reference.
- [README](README.md): install, quick start, CLI and MCP server.
- [`docs/authoring.md`](docs/authoring.md): diagrams, budgets and every validation code.
- [`docs/pages.md`](docs/pages.md): answer pages and charts.
- [`docs/import.md`](docs/import.md) and [`docs/mermaid.md`](docs/mermaid.md): imports.
- [`docs/chat.md`](docs/chat.md): AI chats and the [playground](https://yantra.nbk.com.np/playground/).
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

- the Yantra version (`npm ls -g @niyankhadka/yantra`, or `version` in `package.json`) and
  your Node.js and operating system versions;
- the command or MCP tool call you ran and its full output;
- the smallest payload, page or Mermaid / PlantUML / draw.io / Visio file that shows the
  problem, with anything confidential removed;
- a screenshot (`yantra screenshot <file>`) when the problem is visual.

## Security

Do not report vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
