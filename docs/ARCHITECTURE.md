# ApplePI Architecture

**Status: initial v2 vertical slice implemented.** The v2 slice is a Bun +
TypeScript CLI that turns a human objective into durable SQLite state,
executes it via CAO → OMP sessions in an isolated Git worktree, verifies the
result deterministically, and integrates it back to main only on a PASS.
The Gas City phase0 implementation is preserved on branch `phase0-pi-codex`.
`docs/ROADMAP.md` is the full plan; this document records the implemented
slice and the pinned dependency versions mandated by `docs/ROADMAP.md` §8.1.

## Current implemented architecture

The real current flow:

1. `bun run applepi run --repo <path> --objective "<human objective>"` opens
   `.applepi/applepi.db`, persists the objective as `running` with the repo
   base commit, and asserts main is clean.
2. ApplePI creates an isolated Git worktree at
   `.applepi/worktrees/objective-<id>` on branch `applepi/objective-<id>`.
3. **Phase A** (executive session via CAO, profile
   `applepi-executive-a.md`): the executive reads the repository and the
   human objective (authoritative), then writes a 1–3 question clarification
   request to `.applepi/clarification/request.json`. ApplePI validates it
   and asks the human (TTY or `APPLEPI_CLARIFY_ANSWER`); the answer is
   stored in `.applepi/clarification/answer.json`.
4. **Phase B1** (`applepi-executive-b1.md`): the executive finalizes the
   bounded direction and decomposes it into 1–4 segments, writing
   `.applepi/segments.json`. No workers run in this phase.
5. ApplePI validates the segments and persists one task row per segment
   (`pending` → `running`, with `worktree_path`) — durable before any
   execution, so a crash mid-run leaves an inspectable record.
6. **Phase B2** (`applepi-executive-b2.md`): the executive executes exactly
   the persisted segments, spawning one worker subagent per segment that
   commits with an `applepi-task-<n>:` prefix.
7. ApplePI moves tasks to `verifying` and runs the deterministic verifier
   (clean worktree, commits present, segment-prefix attribution,
   `bun install --frozen-lockfile`, `bun run check`).
8. On PASS, ApplePI resolves each task's commit SHA (persisted for
   diagnostics), then integrates via `integrateBranch`: `git merge --ff-only`
   first, `git cherry-pick <base>..<branch>` as fallback, and
   `git cherry-pick --abort` on conflict (main is left clean, never in an
   unresolved cherry-pick state).
9. Tasks → `completed` and objective → `completed` only after integration
   succeeds; the worktree + branch are then removed. Any failure (executive
   session, invalid request/segments, verifier FAIL, integration failure)
   flips the objective and in-flight tasks to `failed` and retains the
   worktree + branch for inspection.

## Implemented

- Bun/TypeScript CLI.
- SQLite objective/task persistence.
- Isolated Git worktree.
- CAO → OMP execution (Phase A / B1 / B2 with explicit phases).
- Bounded segment decomposition.
- Deterministic verification.
- Integration on verification pass.

## Not implemented

- Crash recovery/resume.
- Direct per-task ApplePI scheduling.
- Parallel workers.
- DAG dependencies.
- Automatic repair.
- Harbor factory evaluation.

## Target repository layout

One Bun project per `docs/ROADMAP.md` §7: `src/` (factory, runtime,
persistence, scheduling, worktrees, verification, repair, integration,
tracing, evals), `tests/` (unit, integration, recovery, fixtures),
`bench/harbor/` (evaluation harness), `docs/`. Only the v2 slice files
exist so far.

## Pinned dependencies

Mandated by `docs/ROADMAP.md` §8.1. Do not build reproducibility around
"latest" — all pins are exact tags/commits.

| Component | Role in v2 | Upstream | Release | Commit SHA | Install (deferred) | Status |
|---|---|---|---|---|---|---|
| CAO | process/session orchestration | awslabs/cli-agent-orchestrator | v2.5.0 (2026-08-28) | `a5ccbe2624aabadfbdf64642c5f1e364db299ec3` | `uv tool install git+https://github.com/awslabs/cli-agent-orchestrator.git@v2.5.0` (or PyPI `cli-agent-orchestrator==2.5.0`) | installed — used by the opt-in e2e (cao 2.5.0) |
| OMP (Oh My Pi) | coding agent (workers) | can1357/oh-my-pi | v17.2.10 | `43c1b245e79f845c7ed7c692b79b4acd0f5c56af` | `curl -fsSL https://omp.sh/install \| sh` (or `bun install -g @oh-my-pi/pi-coding-agent`) | installed (18.1.2 on dev machine; pinned target 17.2.10 — note the drift) |
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
  `pi`/generic provider.
- Do not build reproducibility around "latest" (ROADMAP §8.1); all recorded
  pins are exact tags/commits.
- `pi-interactive-subagents` is planned for Phase 2 (Scout/Researcher
  subagents); its SHA is recorded at fork time, per `docs/ROADMAP.md`.
