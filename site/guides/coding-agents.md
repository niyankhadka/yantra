---
description: Set up Claude Code, Cursor, Codex or Antigravity with yantra init, then ask for architecture, sequence, ER and lifecycle diagrams of your repository.
---

# Diagrams from your codebase with a coding agent

A coding agent can read your repository and draw it: the architecture, the request that
matters, the data model, the lifecycle of an order. Yantra gives the agent a skill that
explains how, an MCP server to validate, build and screenshot, and a validator that catches
mistakes before you see them.

## 1. Set up the project

Run this at the root of your repository:

```bash
npx @niyankhadka/yantra init
```

With no flags, `init` sets up the agents whose files already exist in the folder
(`.claude/` or `CLAUDE.md` for Claude Code, `.cursor/` for Cursor, `.codex/` or `AGENTS.md`
for Codex, `.agents/` for Antigravity), and Claude Code when it finds none. Pick agents
explicitly with flags:

```bash
npx @niyankhadka/yantra init --claude --cursor   # or --codex, --antigravity, --all
npx @niyankhadka/yantra init --all --dry-run     # show what it would write, write nothing
```

| Agent | What `init` writes | Use it |
|---|---|---|
| Claude Code | `.claude/skills/yantra/SKILL.md`, the `yantra` server in `.mcp.json` | `/yantra`, or ask for a diagram |
| Cursor | `.cursor/rules/yantra.mdc`, the server in `.cursor/mcp.json` (and the skill) | `/yantra`, or ask for a diagram |
| Codex | `.agents/skills/yantra/SKILL.md`, a section in `AGENTS.md`, the server in `.codex/config.toml` | `$yantra`, or ask for a diagram |
| Antigravity | `.agents/skills/yantra/SKILL.md`, `.agents/rules/yantra.md`, the server in `.agents/mcp_config.json` | ask for a diagram |

`init` writes only inside the project, never overwrites a file it did not write (`--force`
replaces only the Yantra parts), merges MCP configs so your other servers stay, and changes
nothing when run a second time. On Windows it writes `cmd /c npx ...` for the MCP server,
because agents cannot start the `npx` shim directly there.

Commit the new files so the whole team gets the same setup, then restart the agent and
approve the `yantra` MCP server when it asks. The full reference, including manual setup
and Claude Desktop, is [Coding agents](../../docs/agents.md).

## 2. Ask for a diagram

The skill's description names the requests it is for (diagram, visualise, architecture,
flow, sequence, ERD, state machine, org chart, mind map, explainer, one-page answer, Mermaid
or draw.io import), so you can simply ask. To be explicit, start with `/yantra` (Claude
Code, Cursor) or `$yantra` (Codex).

Example prompts for a typical SaaS repository:

```text
/yantra Draw the architecture of this repo: clients, services, queues, data stores and
external APIs. Walk through what happens when a user signs up.

/yantra Sequence diagram of the login flow, from the browser to the session cookie,
including the OAuth redirect and the token exchange. One step per message.

/yantra ERD of the billing tables from the migrations: customers, subscriptions,
invoices, payments. Key columns first.

/yantra State machine for subscription status, from the enum and the code that changes
it. Edge labels are the events.

/yantra Our Stripe webhook handler: what happens for invoice.paid, step by step, and where
it can fail.

/yantra One-page answer: should we move the job queue from Redis to Postgres? Compare
the options and recommend one.
```

Good prompts name the question the diagram answers, the scope (which service, which flow)
and the audience. "For a new engineer on the payments team" leads to different detail than
"for the architecture review".

## 3. What the agent does

The skill tells the agent to:

1. **Read before drawing**: routes and entry points, services and their clients, queues and
   jobs, infrastructure files, the schema or migrations. It draws what the code does, not
   what names suggest, and records the source file on each card (`data.sourceFile`).
2. **Pick the form**: a flow diagram for architecture, a sequence diagram for auth, payment
   and webhook flows, an ERD for the schema, a state machine for lifecycles, an overview with
   drill-down for large systems, an answer page for a question.
3. **Stay in budget**: at most 14 cards as the diagram opens, 3 to 8 walkthrough steps,
   short edge labels. Bigger systems become an overview whose cards open detail diagrams.
4. **Finish**: validate and fix errors, build the HTML, take a screenshot and look at it,
   then report the file path and the walkthrough.

Files go to `docs/diagrams/<name>.json` and `docs/diagrams/<name>.html` unless your project
already has a place for diagrams.

## 4. Review the result

Open the HTML and step through it. Then check:

- **Is it true?** Click a card: the inspector shows its description, tech and source file.
  Spot-check two or three against the code. Agents can confuse a planned component with a
  real one, so ask "show me the file for this card" when unsure.
- **Does the walkthrough tell the story?** Each step should highlight only the cards and
  edges involved, with a sentence a newcomer understands.
- **Is it the right size?** If the overview is crowded, ask the agent to fold a group or to
  split a subsystem into a detail diagram (drill-down).
- **Any warnings left?** Run `npx @niyankhadka/yantra validate docs/diagrams/<name>.json`
  yourself. Warnings do not stop the build but are worth fixing.

Ask for changes in plain words: "merge the two cache cards", "add the retry path as step 4",
"use the dark theme for the screenshot". The JSON is small and diff-friendly, so changes are
easy to review in a pull request.

## 5. Keep diagrams current

Because the source is JSON in the repository, a diagram can be updated in the same pull
request as the code it describes. Two habits help:

- Validate in CI so a broken diagram fails the build (`validate` checks one file per call):

  ```bash
  for f in docs/diagrams/*.json; do npx -y @niyankhadka/yantra validate "$f" || exit 1; done
  ```

- Link the built HTML from your README or docs, or attach it to the pull request.

## Without the MCP server

The skill falls back to the CLI (`npx -y @niyankhadka/yantra validate|build|screenshot`,
plus `schema`, `docs` and `examples`), so it also works in agents that can only run
commands. `yantra schema` and `yantra docs authoring` print the rules for an agent to read.
