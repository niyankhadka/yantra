# Using Yantra from AI chats

A chat app cannot run Yantra, but it can write the JSON that Yantra draws. The pieces:

- **Playground**, https://niyankhadka.github.io/yantra/: paste the JSON, see the findings and
  the interactive diagram or page, download it. It runs in the browser (no server, nothing
  uploaded) and keeps working offline once loaded.
- **Packs** in [`chat/`](../chat/): a prompt for any chat, a skill for Claude.ai and the
  files for a custom GPT. They teach the same rules and examples (a test checks that).
- **MCP**, for chat apps that can call tools: the local server for Claude Desktop, or a
  remote one you host for Claude.ai and ChatGPT connectors.

Coding agents (Claude Code, Cursor, Codex, Antigravity) run the CLI and are set up with
`yantra init`: see [agents.md](agents.md).

App menus change often. Where a step names a menu, check the app's current help if it has moved.

## Any chat

1. Open the playground and press **Copy prompt for your chat**, or copy
   [`chat/prompt.md`](../chat/prompt.md).
2. Paste it as the first message of a chat (or into the app's custom instructions, a Gemini
   Gem, a project's instructions...), then ask: "Show how a card payment reaches the merchant's
   bank, step by step" or "Should we build or buy a CRM? One page".
3. The chat answers with one ```json block. Copy it (the copy button of the code block is
   easiest) and paste it into the playground. Pasting the whole reply also works: the
   playground takes the JSON out of the surrounding text.
4. Read the **Validation** list. If there are errors, copy them back into the chat ("fix
   these: ...") and paste the corrected JSON. Warnings are worth fixing but do not stop the
   preview.
5. Download what you need: **Standalone HTML** (the interactive file, works offline, same
   as `yantra build`), **SVG** or **PNG** (diagrams), **Markdown** (to paste into a ticket or
   wiki) or the **JSON** to keep.

To build on your own machine instead: save the block as `diagram.json` and run
`npx -y @niyankhadka/yantra build diagram.json` (Node.js 20.19 or later).

**Load an example** in the playground opens any gallery example, which helps to show a chat
what you want ("make one like this, about our onboarding process").

## Claude.ai skill

The skill teaches Claude when and how to answer with Yantra JSON, with the schemas and
examples alongside. It is the chat edition of the coding-agent skill in
[`skills/yantra/`](../skills/yantra/SKILL.md): same name and rules, written for a chat
without a shell.

1. Build the zip from a clone: `npm install`, then `npm run pack:skill`. It writes
   `dist-chat/yantra-skill.zip` (about 35 kB: `yantra/SKILL.md`, two schemas and seven
   examples).
2. In Claude.ai, open the skills settings (Settings > Capabilities at the time of writing;
   skills need code execution to be on) and upload the zip.
3. Ask for a diagram in any chat. Claude replies with the JSON and the playground link; with
   code execution and network access it may also validate and build the file itself.

The skill's source is [`chat/claude-skill/yantra/SKILL.md`](../chat/claude-skill/yantra/SKILL.md).

## ChatGPT custom GPT

Files: [`chat/chatgpt/`](../chat/chatgpt/). `npm run pack:gpt` gathers everything into
`dist-chat/yantra-gpt/`.

1. In ChatGPT, create a GPT (Explore GPTs > Create) and open **Configure**.
2. **Name**: Yantra diagrams. **Description**: "Interactive step-by-step diagrams and
   one-page answers as Yantra JSON."
3. **Instructions**: paste [`instructions.md`](../chat/chatgpt/instructions.md) (5,296
   characters; the field takes 8,000).
4. **Conversation starters**: the lines of
   [`conversation-starters.md`](../chat/chatgpt/conversation-starters.md).
5. **Knowledge**: upload every file in `dist-chat/yantra-gpt/knowledge/`: a short authoring
   guide, the two schemas and seven examples (`example-*.json`).
6. Capabilities are optional: the GPT only writes JSON. Save it (keep it private, or share
   it by link).

The GPT answers with a JSON block and the playground link, as in [Any chat](#any-chat).

## Claude Desktop

Claude Desktop runs local MCP servers, so it can validate, build and screenshot by itself.
Settings > Developer > Edit Config opens `claude_desktop_config.json`. Claude Desktop has no
project folder, so give the server one to read from and write to.

macOS and Linux:

```json
{
  "mcpServers": {
    "yantra": {
      "command": "npx",
      "args": ["-y", "@niyankhadka/yantra", "mcp"],
      "env": { "YANTRA_INPUT_ROOT": "/Users/you/diagrams", "YANTRA_OUTPUT_ROOT": "/Users/you/diagrams" }
    }
  }
}
```

Windows (apps cannot start the `npx` shim directly, so go through `cmd /c`):

```json
{
  "mcpServers": {
    "yantra": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@niyankhadka/yantra", "mcp"],
      "env": { "YANTRA_INPUT_ROOT": "C:\\Users\\you\\diagrams", "YANTRA_OUTPUT_ROOT": "C:\\Users\\you\\diagrams" }
    }
  }
}
```

Create the folder first and restart Claude Desktop. Then ask: "Make a Yantra diagram of our
order flow and save it as order-flow.html". The files appear in that folder. More clients:
[agents.md](agents.md).

## Connectors (remote MCP)

Claude.ai custom connectors and ChatGPT developer-mode connectors call an MCP server by URL.
`yantra mcp --http` is that server; you host it (the project runs none). It needs a public
HTTPS address and, ideally, authentication in front of it. Deploy guide, protocol and security
model: [remote-mcp.md](remote-mcp.md).

## Hosting the playground

The playground is a static site built from [`playground/`](../playground/):

```bash
npm run dev:playground      # http://localhost:3001/yantra/
npm run build:playground    # dist-pages/
npm run preview:playground  # serve dist-pages/ at http://localhost:4174/yantra/
```

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds it on every push to
`main` and deploys it to GitHub Pages. Enable that once in the repository: **Settings >
Pages > Build and deployment > Source: GitHub Actions**. Until then the workflow skips the
build and the deploy with a notice. For another host or path, set
`YANTRA_PLAYGROUND_BASE` (default `/yantra/`) when building and serve `dist-pages/` as static files.
