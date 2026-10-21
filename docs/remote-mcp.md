# Remote MCP server (Streamable HTTP)

Serve Yantra's MCP tools over HTTP with `yantra mcp --http`, for Claude.ai and ChatGPT
connectors and other clients that reach a server by URL. You host it; the project runs none.

`yantra mcp` speaks MCP over stdio, for clients that start it on your machine (Claude Code,
Claude Desktop, Cursor, Codex: see [agents.md](agents.md)). `yantra mcp --http` serves the
same tools over **Streamable HTTP**, the MCP transport for servers reached by URL, such as
custom connectors in Claude.ai and ChatGPT. Needs Yantra 1.1.0 or later.

```bash
npx -y @niyankhadka/yantra mcp --http                 # http://127.0.0.1:8787/mcp
npx -y @niyankhadka/yantra mcp --http --port 9000 --host 127.0.0.1
```

Nothing here is hosted by the Yantra project: you run the server yourself. Chat apps connect
from their own servers, so for them the endpoint must be reachable on the public internet over
HTTPS. Read the security model before you expose it.

## Protocol

- One endpoint, `/mcp` (`YANTRA_MCP_PATH` changes it), as in the MCP 2025-06-18 transport
  specification. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05 are accepted.
- `POST` carries one JSON-RPC message. A request gets one `application/json` response; a
  notification or a response from the client gets `202 Accepted`. JSON-RPC batches are
  refused (they were removed from the 2025-06-18 specification).
- `initialize` returns an `Mcp-Session-Id` header; later requests must send it (missing:
  `400`, unknown or ended: `404`, so the client initializes again). An `MCP-Protocol-Version`
  header, when sent, must name a supported version (`400` otherwise).
- `GET` answers `405`: the server sends no messages of its own, so there is no event stream.
  `DELETE` with the session id ends a session.
- Tools: the stdio set without `yantra_screenshot` (it starts a local browser) and without
  file paths (see below). `yantra_build` returns the HTML as an embedded `text/html`
  resource next to the validation report; `yantra_export` returns SVG or Markdown text;
  the import tools return the payload.

## Security model

| Measure | Default | Setting |
|---|---|---|
| Listen address | `127.0.0.1` (this machine only) | `--host`, `YANTRA_MCP_HOST` |
| Port | `8787` | `--port`, `YANTRA_MCP_PORT`, else `PORT` (set by many hosts) |
| `Host` header | on a loopback address, only `localhost`, `127.0.0.1` and `[::1]` are served (DNS rebinding) | `YANTRA_MCP_ALLOWED_HOSTS=a.example,b.example` |
| `Origin` header | requests that carry one are refused (`403`) unless it is listed, or is a loopback origin while the server is on loopback; requests without one (server-to-server) are served | `YANTRA_MCP_ALLOWED_ORIGINS=https://a.example` |
| Authentication | none | `YANTRA_MCP_TOKEN=<secret>` requires `Authorization: Bearer <secret>` (`401` otherwise) |
| Files | **none**: no tool reads or writes the server's disk. Payloads come in, results go out; page `src` and drill-down `$ref` files are not loaded (the validator reports them) and PlantUML `!include` is not followed | `YANTRA_INPUT_ROOT=/srv/in` allows `filePath` reads inside that folder; `YANTRA_OUTPUT_ROOT=/srv/out` allows `outputPath` writes inside it; with both, `yantra_screenshot` is offered |
| Request size | 4 MB | `YANTRA_MCP_MAX_BODY` (bytes) |
| Sessions | at most 1000, each forgotten after an hour without requests | - |

Without file roots every tool is a pure function of its arguments: the worst a caller can do
is use CPU (layout and validation of large payloads). So:

- Keep the default `127.0.0.1` unless something outside the machine must reach it.
- On the internet, put the server behind an HTTPS reverse proxy (Caddy, nginx, your
  platform's load balancer) that terminates TLS, limits request rates and, ideally,
  authenticates callers. Bind the server to a private address behind it.
- Set `YANTRA_MCP_TOKEN` whenever the client can send a header. Chat apps' connector
  screens may support only OAuth or no authentication (see below); then authenticate at the
  proxy or an MCP-aware gateway, or accept an open, compute-only endpoint with rate limits.
- Do not set `YANTRA_INPUT_ROOT` / `YANTRA_OUTPUT_ROOT` on a shared or public server.

## Deploy

### Docker (one line)

```bash
docker run --rm -p 127.0.0.1:8787:8787 node:22-alpine \
  npx -y @niyankhadka/yantra mcp --http --host 0.0.0.0 --port 8787
```

Inside the container the server binds `0.0.0.0` (so the port mapping reaches it); the
mapping publishes it on the host's loopback only. To serve a proxy on another machine,
publish on a private address instead and add `-e YANTRA_MCP_TOKEN=...`. Pin a version
(`@niyankhadka/yantra@1.1.0`) for repeatable deploys.

### Any Node host

Node.js 20.19 or later. On a VM, or a platform that runs a start command and sets `PORT`:

```bash
npm install @niyankhadka/yantra
YANTRA_MCP_TOKEN=change-me npx yantra mcp --http --host 0.0.0.0
```

Point the platform's HTTPS route at that port; the MCP URL is
`https://<your-domain>/mcp`. Check that an `initialize` POST returns an `Mcp-Session-Id`
header:

```bash
curl -si https://<your-domain>/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -H 'Authorization: Bearer change-me' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

## Connect a chat app

Both apps need the public `https://` URL of the endpoint; neither can reach `localhost`.
Their screens change often, so treat the steps as a guide and **check the current docs**.

- **Claude.ai** (custom connectors, on plans that offer them): Settings > Connectors > Add
  custom connector, then the URL. At the time of writing a connector authenticates with
  OAuth or not at all; a static bearer token cannot be entered there (check current docs).
  Once added, enable it in a chat from the tools menu.
- **ChatGPT** (developer mode connectors, on plans that offer them): turn on developer mode
  in the settings (under connectors or apps, advanced), then create a connector with the
  URL. Authentication options are OAuth or none at the time of writing (check current docs).
- **Claude Desktop, Claude Code and other local clients** do not need this: use stdio
  (`npx -y @niyankhadka/yantra mcp`, see [agents.md](agents.md)).

Without a connector, any chat can still write Yantra JSON for the playground: see
[chat.md](chat.md).
