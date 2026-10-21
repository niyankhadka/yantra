# Using Yantra with coding agents

Set up Claude Code, Cursor, Codex, Antigravity or any agent that can run a command or call an
MCP server to write, validate and build Yantra diagrams. The quickest setup is `yantra init`
in your project; this page explains what it writes and how to set each agent up by hand.

## `yantra init`

```bash
npx @niyankhadka/yantra init [--claude] [--cursor] [--codex] [--antigravity] [--all]
                             [--dir path] [--force] [--dry-run] [--json] [--windows | --posix]
```

- **Which agents.** With no agent flags, `init` sets up the agents whose files already exist
  in the folder (`.claude/`, `CLAUDE.md` or `.mcp.json` for Claude Code; `.cursor/` for
  Cursor; `.codex/` or `AGENTS.md` for Codex; `.agents/` for Antigravity). When none exist it
  sets up Claude Code. It never asks a question, so it is safe in scripts and CI.
- **Where.** The current folder, or `--dir path`. It writes only inside that folder and
  refuses a path that leaves it (for example through a symbolic link or junction); nothing is
  written outside the project, including your home folder.
- **Existing files.** A file Yantra owns (skill, rule) is written when missing and left alone
  when it differs, unless `--force`. JSON MCP configs are merged: the `yantra` server is added
  and every other server and key stays. `AGENTS.md` and `.codex/config.toml` get a Yantra
  section, added once; `--force` replaces only that section. A config that is not valid JSON
  (for example with comments) is reported and left untouched, and `init` exits with code 1.
- **Again.** Running `init` twice changes nothing the second time.
- **Preview.** `--dry-run` prints the plan without writing; `--json` prints a machine-readable
  report (also what `yantra.init_project()` in the Python SDK returns).

| Agent | Skill | Rules | MCP server |
|---|---|---|---|
| Claude Code | `.claude/skills/yantra/SKILL.md` | - | `.mcp.json` |
| Cursor | read from `.claude/skills/` or `.agents/skills/` when another agent is set up, else `.cursor/skills/yantra/SKILL.md` | `.cursor/rules/yantra.mdc` | `.cursor/mcp.json` |
| Codex | `.agents/skills/yantra/SKILL.md` | section in `AGENTS.md` | `.codex/config.toml` (plus a snippet to copy into `~/.codex/config.toml`) |
| Antigravity | `.agents/skills/yantra/SKILL.md` | `.agents/rules/yantra.md` | `.agents/mcp_config.json` |

The skill is the same file for every agent (`skills/yantra/SKILL.md` in the npm package). It
tells the agent how to plan the story, the budgets, when to use a sequence diagram, an ERD,
a state machine, a tree or an answer page, how to diagram a codebase, and to validate, build
and look at a screenshot before reporting. Its `description` names the requests it is for
(diagram, visualise, architecture, flow, sequence, ERD, data model, state machine, org chart,
mind map, explainer, step by step, one-page answer, Mermaid, PlantUML, draw.io), which is
what agents match to use a skill without being asked. Invoke it directly with `/yantra`
(Claude Code, Cursor) or `$yantra` (Codex).

Commit the files so the whole team gets the setup. Approve the `yantra` MCP server the first
time your agent asks.

## The MCP server command

Every config starts the server with npx, which downloads the package on first use:

```json
{ "command": "npx", "args": ["-y", "@niyankhadka/yantra", "mcp"] }
```

**Windows.** `npx` is a `.cmd` script on Windows, and agents start MCP servers without a
shell, so plain `npx` fails to start there. On Windows `init` writes the form that works:

```json
{ "command": "cmd", "args": ["/c", "npx", "-y", "@niyankhadka/yantra", "mcp"] }
```

The form follows the system `init` runs on. A team that shares the config between Windows
and macOS or Linux can pick one with `--windows` or `--posix`; the other side then edits its
local copy, or uses WSL on Windows (where the plain form works). With Yantra installed in the
project (`npm i -D @niyankhadka/yantra`), npx starts the installed version instead of
downloading.

**Files.** The server reads and writes only inside its working folder (or `YANTRA_INPUT_ROOT`
and `YANTRA_OUTPUT_ROOT`). Claude Code and Codex start it in the project; the Cursor entry
sets both variables to `${workspaceFolder}`. If another client starts it elsewhere, set them
to the project path in the entry's `env`.

Without the MCP server, the skill uses the CLI (`npx -y @niyankhadka/yantra validate|build|screenshot`,
`schema`, `docs`, `examples`), so it still works in agents that only run commands.

## Manual setup

Copy the skill from the package (`node_modules/@niyankhadka/yantra/skills/yantra/SKILL.md`,
or from the repository) where the table above says, and add the server entry below. On
Windows use the `cmd /c` form.

### Claude Code

`.mcp.json` in the project root (or `claude mcp add --scope project yantra -- npx -y @niyankhadka/yantra mcp`):

```json
{
  "mcpServers": {
    "yantra": { "command": "npx", "args": ["-y", "@niyankhadka/yantra", "mcp"] }
  }
}
```

Skill: `.claude/skills/yantra/SKILL.md` (or `~/.claude/skills/yantra/SKILL.md` for every
project).

### Cursor

`.cursor/mcp.json` (or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "yantra": {
      "command": "npx",
      "args": ["-y", "@niyankhadka/yantra", "mcp"],
      "env": { "YANTRA_INPUT_ROOT": "${workspaceFolder}", "YANTRA_OUTPUT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Rule: `.cursor/rules/yantra.mdc` with frontmatter `description`, empty `globs` and
`alwaysApply: false`, so the agent pulls it in when a request matches the description.
Cursor loads skills from `.cursor/skills/`, `.agents/skills/` and `.claude/skills/`, so one
copy of the skill is enough. `init` does not write `.cursor/commands/`; the skill already
gives `/yantra`.

### Codex

`~/.codex/config.toml`, or `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.yantra]
command = "npx"
args = ["-y", "@niyankhadka/yantra", "mcp"]
```

On Windows: `command = "cmd"` and `args = ["/c", "npx", "-y", "@niyankhadka/yantra", "mcp"]`.
Skill:
`.agents/skills/yantra/SKILL.md` (or `~/.agents/skills/`). `AGENTS.md` instructions are read
in every session.

### Antigravity

`.agents/mcp_config.json`, or the raw config from **Manage MCP Servers > View raw config**:

```json
{
  "mcpServers": {
    "yantra": { "command": "npx", "args": ["-y", "@niyankhadka/yantra", "mcp"] }
  }
}
```

Skill: `.agents/skills/yantra/SKILL.md`; rule: `.agents/rules/yantra.md`.

### Claude Desktop

Settings > Developer > Edit Config opens `claude_desktop_config.json`. Claude Desktop has no
project folder, so give the server one to read from and write to:

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

On Windows use the `cmd /c` form and a path such as `C:\\Users\\you\\diagrams`. Restart
Claude Desktop after editing.

## What is less certain

Agent conventions change quickly. The paths above follow each agent's documentation as of
October 2026; where they disagree or are not documented, `init` keeps file contents generic:

- **Antigravity.** Some guides use `.agent/` (singular) for workspace rules and skills, and
  some versions read MCP servers only from the global config under `~/.gemini/`. If the
  server does not appear, add the entry through **View raw config**.
- **Cursor.** The skill exists in more than one folder when several agents are set up;
  whether Cursor lists it once or once per folder is not documented. Custom commands (`.cursor/commands/`) are being
  replaced by skills, so `init` does not write one.
- **Codex.** A project `.codex/config.toml` is read only once the project is trusted; the
  global `~/.codex/config.toml` always works. On native Windows, if `cmd /c npx` does not
  start, use WSL.
