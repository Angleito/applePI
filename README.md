
# applePI

Terminal-first multi-agent software development harness, currently built on
Gas City + Pi. ApplePI is being rebuilt as a long-horizon software factory:
durable work, isolated coding agents, deterministic verification, recovery,
and empirical evaluation. Full plan: [docs/ROADMAP.md](docs/ROADMAP.md).

```text
HUMAN
  │
  ▼
EXECUTIVE (Pi, named session)
  │
  ▼
MANAGER   (Pi, per workstream)
  │
  ▼
WORKER    (Pi, elastic pool)
```

Roles: Human, Executive, Manager, Worker. Scout is planned.

## Why we left Gas City

- No strict `gc.work_dir` enforcement — Gas City's work_dir is diagnostic
  only (gastownhall/gascity#1761), keeping runtime integration blocked and
  the worker pool capped at 0..1.
- Factory state was tied to Gas City's beads/Dolt backend instead of a
  model-neutral, ApplePI-owned durable store.
- Task identity, formulas, and recovery were Gas City-specific — no clean
  path to objective → task DAG → deterministic verification → repair.
- Verification was not part of execution: "agent says done" closed the
  bead; v2 requires the worker never certifies its own completion.
- Rigid Executive → Manager → Worker topology; v2 wants a thin generic
  runtime (CAO) + disposable OMP sessions + factory semantics in ApplePI.

## How to use it right now

Prerequisites: see `UPSTREAM.md` (`gc` 1.4.1, `pi` >= 0.84, `bd`, `dolt`,
`tmux`, `git`, `jq`).

```bash
# Pi backend + role models (gitignored, machine-local)
cp .env.example .env
pi auth check --provider openai-codex --model gpt-5.6-luna

# city bootstrap (once, or after a fresh clone)
gc init --file city.toml --preserve-existing --skip-provider-readiness --no-start --yes .
gc import install
gc start

# register a project as a rig, then attach to the Executive
gc rig add ~/Projects/scratch-proj --name scratch-proj
gc session attach executive
```

Local integration tests (LLM-backed, local-only developer checks; run from
the city repository, not from a running city or an application rig; set
`GC_TEST_KEEP=1` to retain a failed fixture):

```bash
tests/phase0-runtime-integration.sh
tests/worker-recovery.sh
tests/manager-recovery.sh
```

This repository is public. Machine-local state (`.gc/`, `.beads/`, `.pi/`)
is gitignored; Pi credentials live user-local, never in-repo.

## Where it's headed

ApplePI v2 is a long-horizon software factory:

- A human provides an engineering objective; ApplePI decomposes it into a
  durable task DAG stored in SQLite.
- CAO launches and supervises disposable OMP coding agents in isolated Git
  worktrees.
- Deterministic verification gates every completion; failures drive an
  automatic repair loop.
- Worker/session/process crashes are expected and recovered — work outlives
  the agent.
- Harbor evaluates the factory empirically against frozen benchmarks.

The v2 foundation is not implemented yet; [docs/ROADMAP.md](docs/ROADMAP.md)
is the plan. This README describes the current system only.

