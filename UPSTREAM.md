# Upstreams and Pins

This harness consumes three sources. Only two are ever modified.

## Gas City — pinned, never forked

| Item          | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Repository    | https://github.com/gastownhall/gascity                       |
| Release       | **v1.4.1** (2026-08-15)                                      |
| Release SHA   | `58ef17e3bd685fd5cf7f21286277b208d3324590`                   |
| Install       | `gascity_1.4.1_linux_amd64.tar.gz` (sha256-verified) → `~/.local/bin/gc` |
| Pack pins     | `pack.toml` `[imports]` `version = "sha:f895c0ff…"` + `packs.lock` |

Do not modify Gas City. Consume the pinned release. To bump: update the
release + pack pins together, re-run `gc import install`, and re-run the
integration tests.

## Pi Coding Agent — the only reasoning harness

| Item       | Value                                          |
| ---------- | ---------------------------------------------- |
| Repository | https://github.com/badlogic/pi-mono            |
| Installed  | `~/.local/bin/pi` (0.84.3 at time of writing)  |
| Provider   | `opencode-go` (auth via `pi auth check --provider opencode-go`) |
| Models     | `deepseek-v4-pro` (executive/manager), `deepseek-v4-flash` (worker/scout) — configurable in `city.toml` `[providers.pi]` |

## pi-interactive-subagents — forked (Amos base)

| Item       | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Upstream   | https://github.com/amosblomqvist/pi-interactive-subagents   |
| Fork       | https://github.com/Angleito/pi-interactive-subagents        |
| Base SHA   | TODO: record at fork time                                   |
| Remotes    | `origin` → fork, `upstream` → amosblomqvist/pi-interactive-subagents |
| Install    | `pi install git:github.com:Angleito/pi-interactive-subagents` |

### Local Amos modifications (tracked on the `company-control` branch)

1. `PI_SUBAGENT_ENABLED` — when `0`, the extension registers no subagent
   tools (`subagent`, `subagent_message`, `subagents_list`), no `/subagent`
   command, and no status widget. Executive and Manager run with it off.
2. `PI_SUBAGENT_MAX_RUNNING` — caps concurrent subagents per session
   (Worker runs with `3`; prevents fan-out storms).
3. Verify/enforce `PI_SUBAGENT_ALLOWED` for top-level sessions, not only
   nested subagents (Worker runs with `scout`).

Worker environment (set in `agents/worker/agent.toml`):

```text
PI_SUBAGENT_ENABLED=1
PI_SUBAGENT_ALLOWED=scout
PI_SUBAGENT_MAX_RUNNING=3
```

## Known upstream limitations

- **gastownhall/gascity#1761** — `[beads] provider = "file"` cannot auto-claim
  routed work (work queries are `bd`-only). We therefore run the `bd` (Dolt)
  backend. Revisit if the file store gains query support.
- **gastownhall/gascity#1938** — `mol-scoped-work` control beads may not be
  claimed by the control dispatcher (open at time of writing). Verify before
  relying on it; the harness has a prompt-driven worktree fallback.

## Local install prerequisites

```text
gc    v1.4.1      ~/.local/bin
pi    >= 0.84     ~/.local/bin
bd    v1.2.2      ~/.local/bin   (gastownhall/beads)
dolt  v2.3.1      ~/.local/bin   (dolthub/dolt)
tmux  any         system
git   any         system
jq    any         system