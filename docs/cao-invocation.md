# CAO 2.5.0 + OMP 18.1.2 — verified invocation notes (Step 1, 2026-09-01)

All shapes below were verified against the live `cao --help` / OpenAPI schema
and 15+ real launches this session. CAO was patched for OMP 18.1.2 (see
/tmp/applepi-smoke/cao-patches/README.md); post-fix 8/8 launches reached
`completed`.

## Server
- Start: `cao-server --port 9889` (stdio piped). MUST be supervised — a bare
  `nohup ... &` dies when the spawning shell exits.
- Health: `GET http://localhost:9889/health` -> `{"status":"ok",...}` (poll <=60s).

## Profile install
- `cao install <file> --provider omp` -> `✓ Agent '<name>' installed successfully`.
  Reinstall overwrites. Profile file = YAML frontmatter + markdown body.

## Launch (verified working)
- `cao launch --agents <profile> --provider omp --auto-approve --headless --session-name <name> "<message>"`
  run with cwd = the target directory.
- The CLI sometimes HANGS (observed 30-90s+, then errors "Read timed out");
  the session is still created server-side. Spawn detached, never await exit.
- `--headless` = detached; `--auto-approve` skips CAO's workspace prompt;
  `--session-name` sets a deterministic session name.
- Session appears via HTTP within ~2-10s.

## HTTP state endpoints
- `GET /sessions` -> `[{id, name, status, working_directory, agent_profile}]`
- `GET /sessions/{name}` -> `{session:{...}, terminals:[{id, tmux_session,
  provider, agent_profile, working_directory, status, last_active}]}`
- Terminal status values (lowercase): `unknown|idle|processing|completed|
  waiting_user_answer|error`
- `GET /terminals/{id}/output?mode=full|last` -> `{output, mode}`
- Healthy transitions (post-fix): unknown -> idle -> processing -> completed.

## Shutdown
- `cao shutdown --session <name>` -> `✓ Shutdown session '<name>'` (ignore
  not-found errors).

## Known platform quirks (WSL2, fixed in CAO patch)
- tmux 3.6 `pipe-pane -> FIFO` forwarding is delayed (4-20s+) or stalls; CAO
  patched to fall back to live-pane history for shell-ready + status.
- OMP 18.1.2 emits `\x1b]777;notify;warp://cli-agent;{"event":"stop",...}` at
  turn end; patched CAO uses it as the COMPLETED anchor.
