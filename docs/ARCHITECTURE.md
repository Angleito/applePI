# ApplePI Architecture

**Status: the v2 foundation is not implemented.** The current system is the
Gas City + Pi harness described in `README.md`; `UPSTREAM.md` holds the
current-runtime pins. This document records the v2 target architecture and
the pinned dependency versions mandated by `docs/ROADMAP.md` §8.1.

## Current implemented architecture

The phase0 harness combines Gas City (city/rig orchestration) with the Pi
Coding Agent (reasoning). Executive/Manager/Worker role agents drive the
factory; `tests/*.sh` covers integration and recovery flows. See
`UPSTREAM.md` for current-runtime pins (`gc` v1.4.1, Pi 0.84.3, `bd` v1.2.2,
dolt) and `README.md` for usage. The old Gas City implementation is preserved
on branch `phase0-pi-codex`.

## Target architecture

- Human provides an engineering objective → **ApplePI** (Bun + TS; durable
  SQLite factory state) decomposes it into a task DAG.
- ApplePI hands tasks to **CAO** (lifecycle, sessions, dispatch, recovery),
  which launches and supervises **OMP workers** (Oh My Pi) in isolated Git
  worktrees.
- Completions flow to the **ApplePI deterministic verifier**: PASS →
  integrate; FAIL → repair → re-run through OMP.

Responsibility boundaries:

- OMP context stays inside OMP.
- CAO runtime/session state stays inside CAO.
- ApplePI stores only factory state.

## Target repository layout

One Bun project per `docs/ROADMAP.md` §7: `src/` (factory, runtime,
persistence, scheduling, worktrees, verification, repair, integration,
tracing, evals), `tests/` (unit, integration, recovery, fixtures),
`bench/harbor/` (evaluation harness), `docs/`. Nothing beyond this step's
files is created yet.

## Pinned dependencies

Mandated by `docs/ROADMAP.md` §8.1. Do not build reproducibility around
"latest" — all pins are exact tags/commits.

| Component | Role in v2 | Upstream | Release | Commit SHA | Install (deferred) | Status |
|---|---|---|---|---|---|---|
| CAO | process/session orchestration | awslabs/cli-agent-orchestrator | v2.5.0 (2026-08-28) | `a5ccbe2624aabadfbdf64642c5f1e364db299ec3` | `uv tool install git+https://github.com/awslabs/cli-agent-orchestrator.git@v2.5.0` (or PyPI `cli-agent-orchestrator==2.5.0`) | not installed — Phase 0 §8.2 |
| OMP (Oh My Pi) | coding agent (workers) | can1357/oh-my-pi | v17.2.10 | `43c1b245e79f845c7ed7c692b79b4acd0f5c56af` | `curl -fsSL https://omp.sh/install \| sh` (or `bun install -g @oh-my-pi/pi-coding-agent`) | not installed — Phase 0 §8.2 (CAO fixtures target 17.2.10) |
| pi-interactive-subagents | Scout/Researcher subagents | amosblomqvist/pi-interactive-subagents | — | not pinned | — | planned Phase 2 (per UPSTREAM.md) |
| Harbor | evaluation harness | harbor-framework/harbor | v0.22.0 (2026-08-22) | `4407eb5227a2ff4f0d3f16b2eb48849382fdf276` (peeled commit of tag v0.22.0) | `uv tool install harbor==0.22.0` | installed — oracle demo PASS (2026-08-31), see below |

Oracle demo (2026-08-31): **PASS** — 2/2 trials (reward 1.0 each, 0
exceptions), dataset `terminal-bench@2.0`, task IDs `overfull-hbox` and
`filter-js-from-html`, oracle agent, 1 attempt, concurrency 1, Harbor-native
Docker task containers. Command: `harbor run -d terminal-bench@2.0 -a oracle
-i overfull-hbox -i filter-js-from-html -k 1 -n 1 -o ~/.cache/harbor/jobs
-y`. Repeatable via `bench/harbor/demo.sh`. This PASS is manual evidence —
recorded from a run of `bench/harbor/demo.sh`; no CI workflow enforces it.

- OMP identity decision: v2 uses Oh My Pi (can1357/oh-my-pi) because CAO's
  hard-coded provider registry supports `omp` natively and has no
  `pi`/generic provider; badlogic Pi 0.84.3 remains the current-runtime
  agent until v2 replaces it.
- Do not build reproducibility around "latest" (ROADMAP §8.1); all recorded
  pins are exact tags/commits.
- §8.1 is intentionally partially deferred for pi-interactive-subagents: per
  UPSTREAM.md its base SHA is recorded at fork time (Phase 2), not before;
  the table above is complete for every other component.
