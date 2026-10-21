---
description: How Yantra releases work, how to pin a version, and how to host the MCP server over HTTP for Claude.ai and ChatGPT, or this website, yourself.
---

# Releases and self-hosting

Yantra is a set of files you run yourself: nothing here depends on a service the project
operates. This guide covers versions, pinning, and running the parts that can be hosted:
the HTTP MCP server and the playground.

## Releases

- The npm package (`@niyankhadka/yantra`) and the Python SDK (`niyankhadka-yantra`) share
  one version number and are published together when a version tag is pushed. The release
  workflow runs the test suite first and checks that both packages carry the tag's version.
- Every change is listed in the [changelog](../../CHANGELOG.md), newest first, following
  Keep a Changelog and Semantic Versioning: a patch release fixes, a minor release adds,
  a major release may change payloads or commands.
- The JSON schemas ship in the package (`schemas/`), and `yantra schema` prints the one the
  installed version validates against.

## Pin a version

For repeatable builds in CI or a team, pin the version instead of fetching the latest:

```bash
npm i -D @niyankhadka/yantra@1.1.0          # in the project, so npx uses this copy
npx -y @niyankhadka/yantra@1.1.0 build x.json  # or pin it in the command
pip install niyankhadka-yantra==1.1.0
```

With the package installed in the project, the MCP entries `yantra init` writes
(`npx -y @niyankhadka/yantra mcp`) start the installed version rather than downloading one.

## Host the MCP server over HTTP

Local agents start the MCP server themselves over stdio and need nothing hosted. Chat apps
that connect to tools by URL (Claude.ai custom connectors, ChatGPT developer-mode
connectors) need a server on the public internet, and you host it:

```bash
npx -y @niyankhadka/yantra mcp --http          # http://127.0.0.1:8787/mcp
```

By default it binds `127.0.0.1`, checks the `Origin` and `Host` headers, and has **no file
access**: payloads come in, HTML, SVG, Markdown or payloads go out. Before exposing it:

1. Put it behind an HTTPS reverse proxy (Caddy, nginx or your platform's load balancer)
   that terminates TLS and limits request rates.
2. Set `YANTRA_MCP_TOKEN` and send `Authorization: Bearer <token>` where the client allows
   it; otherwise authenticate at the proxy.
3. Do not set `YANTRA_INPUT_ROOT` or `YANTRA_OUTPUT_ROOT` on a shared or public server.
4. Pin the version (`@niyankhadka/yantra@1.1.0`) so deploys are repeatable.

A one-line Docker start, the protocol details, the full security model and the connector
steps for each app are in [Remote MCP server](../../docs/remote-mcp.md).

## Host the playground and this site

This website, including the playground, is static: no backend, no database. It is built
from the repository and served by GitHub Pages, and you can host your own copy:

```bash
git clone https://github.com/niyankhadka/yantra.git
cd yantra
npm install
npm run build:site       # -> dist-pages/
npm run preview:site     # serve it at http://localhost:4174/
```

Serve `dist-pages/` from the root of a domain or subdomain with any static host. The
playground lives at `/playground/` and keeps working offline once loaded (a service worker
scoped to that folder). `npm run dev:site` starts a development server with the docs
rendered on request.

The docs pages are generated from the repository's `docs/*.md` and `site/guides/*.md`, so a
fork's site always documents the fork.

Search engines: every page has its own title, description, canonical URL and structured
data, and `sitemap.xml` dates each page by the last commit of its source file (a full clone
gives real dates; a shallow one gives the date of its single commit). To prove ownership to
Google Search Console or Bing Webmaster Tools, set `YANTRA_SITE_GOOGLE_VERIFICATION` or
`YANTRA_SITE_BING_VERIFICATION` to the code the tool gives you when you build. The Pages
workflow reads them from repository variables of the same names (**Settings > Secrets and
variables > Actions > Variables**); unset, no verification tag is written.

## Offline and air-gapped use

- Built HTML files need nothing at all: open them from disk.
- The CLI needs Node.js and the package. Install it once from npm, or from a tarball made
  with `npm pack` in a clone, then it runs without network access.
- The Python SDK calls the CLI; set `YANTRA_CLI` to an installed `bin/yantra.js` and
  `YANTRA_NO_NPX=1` so it never tries to download.
