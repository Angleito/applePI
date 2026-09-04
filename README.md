# applePI

Terminal-first multi-agent software development harness. ApplePI is a
long-horizon software factory: durable work, isolated coding agents,
deterministic verification, and empirical evaluation. Full plan:
[docs/ROADMAP.md](docs/ROADMAP.md).

**Status: initial v2 vertical slice implemented.** See "Implemented" below
for exactly what exists and what does not.

## Why we left Gas City

- Too dangerous security-wise: Gas City injected into the agent — untrusted
  content (bead/issue/PR/repo text) fed straight into the agent's context,
  plus its own session/runtime hooks in the running agent. That injection
  path enabled arbitrary command execution with full user privileges.
- Too many technical moving parts that complicated the project.

Gas City (phase0) survives only as archived history: the implementation on
branch `phase0-pi-codex`, the rationale in [docs/ROADMAP.md](docs/ROADMAP.md).

## How to use it

Prerequisites: CAO 2.5.0 and OMP (Oh My Pi) installed, plus `bun` and `git`.
Verified invocation notes: [docs/cao-invocation.md](docs/cao-invocation.md).

```bash
# Deterministic checks (typecheck + unit/integration tests; offline)
bun run check

# Run an objective end to end (clarification is asked on a TTY, or set
# APPLEPI_CLARIFY_ANSWER when stdin is not a TTY)
bun run applepi run --repo <path> --objective "<human objective>"

# Opt-in end-to-end test against a live CAO + OMP (long-running)
APPLEPI_E2E=1 bun test tests/e2e.test.ts
```

## How it works

The v2 execution flow:

1. **Human objective** → ApplePI persists it as a `running` objective in
   SQLite and captures the repo base commit.
2. ApplePI creates an **isolated Git worktree** on branch `applepi/objective-<id>`.
3. **Executive clarifies** (Phase A, via CAO): the human is in the loop and
   is the authority for every decision; ApplePI fails rather than guess. An empty answer resolves to "Proceed with your proposal."; a bare number picks that choice, anything else is taken as free text.
4. **Executive decomposes** (Phase B1): writes `.applepi/segments.json`.
5. ApplePI persists one **task row per segment** (`pending` → `running`) —
   durable before any execution starts, so a crash mid-run leaves a record.
6. **Executive executes the persisted segments** (Phase B2): worker
   subagents run the repository checks and commit with
   `applepi-task-<n>:` prefixes.
7. ApplePI marks tasks `verifying` and runs the **deterministic verifier**
   (clean worktree, commits present, prefix attribution, `bun install --frozen-lockfile`,
   `bun run check`).
8. On PASS, ApplePI **integrates** into the base branch (the branch checked out when the objective started; `main` in production) (fast-forward merge, with a
   cherry-pick fallback; a failed integration is aborted, leaving the base branch
   clean). Tasks and objective become `completed` only after integration
   succeeds; on any failure they become `failed` and the worktree + branch
   are retained for inspection.

## Implemented

- Bun/TypeScript CLI (`bun run applepi run --repo <path> --objective "<text>"`).
- SQLite objective/task persistence (`.applepi/applepi.db`).
- Isolated Git worktree per objective.
- CAO → OMP execution (explicit Phase A / B1 / B2 executive sessions).
- Bounded segment decomposition (1–4 segments).
- Deterministic verification gating completion.
- Integration on verification pass (ff-only merge or cherry-pick; abort on
  conflict).

## Not implemented

- Crash recovery/resume (a crash leaves rows in their last persisted state,
  inspectable, but nothing resumes them).
- Direct per-task ApplePI scheduling.
- Parallel workers.
- DAG dependencies.
- Automatic repair.
- Harbor factory evaluation.

This repository is public. Machine-local state (`.applepi/`, `*.db`, `.env`)
is gitignored.
