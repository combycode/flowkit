/* The one screen a person reads before anything works. */

export const HELP = `flowkit — a design system and screen flow an agent can work on

RUN
  flowkit                    the MCP server + canvas (what an agent starts)
  flowkit serve              the canvas on its own, without an agent
  flowkit mcp                the tools on their own, no canvas
    --workspace <dir>        a folder of projects
    --project <file>         one project file
    --port <n>               canvas port to start from (or set FLOWKIT_PORT)

WIRE UP A CLIENT
  flowkit init [dir]         write the config for a client (Claude Code default),
                             wherever that client keeps it — the repo, or your
                             home directory — merging so other servers survive
    --client <name>          claude-code | cursor | claude-desktop | codex |
                             antigravity | opencode | windsurf
    --dir <designs>          where the designs live (default: <repo>/design)
    --npx                    invoke via bunx instead of a global install
  flowkit config <client>    just print the snippet and where it goes

MANAGE WHAT IS RUNNING
  flowkit ps                 list running canvases (port, pid, workspace)
  flowkit stop [--port n]    stop one canvas; --all stops every one

PROJECTS (no agent needed)
  flowkit projects           list them
  flowkit new "<name>"       create one   (--dir to put it in a repo)
  flowkit rename <id> "<name>"
  flowkit move <id> <dest>   move the file, keep the id
  flowkit remove <id>        forget it (file kept); --delete removes the file
  flowkit export <id>        --viewer (default) | --html | --spec  [--out <dir>]

The design lives in ONE json file. Everything writes to it through the server,
never by editing it: that is what keeps undo, validation and the canvas honest.`;
