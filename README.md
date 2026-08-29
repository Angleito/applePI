# applePI — Gas City + Pi + Interactive Subagents Orchestration Harness

Terminal-first hierarchical multi-agent software development harness.

```text
HUMAN
  │  interactive conversation
  ▼
EXECUTIVE (Pi, named session)
  │  gc session submit
  ▼
MANAGER   (Pi, one per workstream)
  │  durable Gas City work (beads + sling)
  ▼
WORKER    (Pi, elastic pool)
  │  Amos subagent()
  ▼
SCOUT     (Pi, read-only recon, tmux panes)
```

Five roles only: Human, Executive, Manager, Worker, Scout. Instances get
task-derived names (`manager-auth`, `worker-1`, `scout-2`); domains belong in
assignments, never in the role taxonomy.

## Ownership

| Layer      | Owns                                                             |
| ---------- | ---------------------------------------------------------------- |
| Gas City   | tasks, IDs, dependencies, sessions, routing, capacity, worktrees, recovery, events, mail |
| Pi         | all reasoning, planning, coding, tool use, context               |
| Amos fork  | Worker → Scout spawning, tmux panes, steering, `ask_question`    |

## Layout

```text
agents/executive/   agent.toml + prompt.template.md   (PI_SUBAGENT_ENABLED=0)
agents/manager/     agent.toml + prompt.template.md   (PI_SUBAGENT_ENABLED=0)
agents/worker/      agent.toml + prompt.template.md   (pool 0..8, scout-only)
formulas/worker-task.toml   worktree lifecycle (Phase 4)
pi/agents/scout.md          read-only recon agent
pi/extensions/company-control/  V2 stub — role-aware tools (not yet built)
assets/scripts/             install-worker-subagents.sh, worker-worktree.sh, tmux-setup.sh
bin/harness                 thin CLI over gc/tmux (Phase 9)
tests/                      per-phase integration + failure injection
```

## Quickstart (Phase 0 status)

```bash
# prerequisites — see UPSTREAM.md
gc version      # 1.4.1
pi --version    # >= 0.84
bd version
dolt version

# city bootstrap
gc init . --template minimal --skip-provider-readiness --no-start   # once
gc import install
gc start

# register the project as a rig
gc rig add ~/Projects/my-project --name my-project

# attach to the Executive (the Human's only interface)
gc session attach executive
```

## Worker claim flow

```bash
# a Manager (working in the rig) routes a task
gc sling worker "Implement refresh token rotation..." --title "TASK title"

# a Worker session materializes on demand and claims it
gc hook --claim --json
```

Beads are durable; sessions are disposable. A Worker crash leaves the task
claimable. Manager/Executive sessions resume from Gas City session identity.

## Concurrency defaults

```text
Executive  1
Managers   up to 4 workstreams (created on demand)
Workers    0..8 pool
Scouts     <= 3 per Worker (PI_SUBAGENT_MAX_RUNNING)
```

## Status

Phases 0 done (bootstrap verified end-to-end). See the phase checklist in the
project plan: 1–3 baseline hierarchy, 4 worktrees, 5 Amos fork + scouts,
6 question chain, 7 enforcement, 8 recovery, 9 terminal polish.

## Secrets

This repository is public. Machine-local state (`.gc/`, `.beads/`, rig paths)
is gitignored. Pi authenticates via `~/.pi/agent/auth.json`, never in-repo.