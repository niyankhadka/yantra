# Security policy

How to report a vulnerability in Yantra privately, and what is in scope.

## Supported versions

Security fixes go into the latest release. Older major versions are not patched.

| Version | Supported |
|---|---|
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue:

1. Use GitHub's **Report a vulnerability** button on the repository's
   [Security tab](https://github.com/niyankhadka/yantra/security/advisories/new)
   (private vulnerability reporting).
2. Include the affected version, a description, steps or a file that reproduces the issue,
   and the impact you expect.

You should get an acknowledgement within 5 working days and an assessment within 14 days.
Once a fix is released, the advisory is published with credit to the reporter unless you
ask otherwise.

## Scope

Areas where a report is especially useful:

- **Built HTML files**: a payload or imported diagram that injects script into the
  generated page or escapes the sandboxed viewer used by answer pages.
- **MCP server**: reading or writing files outside `YANTRA_INPUT_ROOT` /
  `YANTRA_OUTPUT_ROOT`, or with extensions other than the allowed ones; with `--http`,
  requests that get past the `Origin`, `Host` or bearer-token checks
  ([remote MCP security model](docs/remote-mcp.md)).
- **Importers**: Mermaid, draw.io, PlantUML or Visio input that crashes the process, hangs
  it, or exhausts memory far beyond the input size.
- **Playground and website**: script injection through pasted JSON or a link.
- **Page `src` references**: loading files outside the page's folder.

Out of scope: problems that need an attacker to already control the local machine, the
Node.js runtime or the browser used for screenshots.
