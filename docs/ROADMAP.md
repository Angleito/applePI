
# ApplePI v2 — Long-Horizon Software Factory
## CAO + OMP + Harbor migration and implementation plan

Repository:
https://github.com/Angleito/applePI


============================================================
0. MISSION
============================================================

Rebuild ApplePI around one clear objective:

ApplePI is a long-horizon software factory.

A human provides an engineering objective.

ApplePI should be able to:

    understand the objective
        ↓
    decompose it into durable work
        ↓
    schedule isolated coding agents
        ↓
    execute work in parallel
        ↓
    continue working for hours
        ↓
    verify outputs deterministically
        ↓
    repair failed implementations
        ↓
    survive agent/session/process crashes
        ↓
    integrate verified changes
        ↓
    record operational traces
        ↓
    evaluate itself empirically in Harbor

The central invariant is:

    WORK OUTLIVES THE AGENT.

An agent session is disposable.

The objective, task graph, artifacts, attempts, verifier results,
and engineering progress are durable.

The model must not be the authoritative source of runtime state.

The worker must not be allowed to certify its own completion.

The architecture should remain useful across arbitrary software repositories,
languages, models, and engineering objectives.


============================================================
1. CORE DESIGN PRINCIPLES
============================================================

1. Sessions are disposable. Work is durable.

2. The model reasons. The runtime constrains.

3. Verification is part of execution, not an afterthought.

4. "Agent says done" means "ready for verification."

5. Deterministic software should replace model judgment wherever possible.

6. Keep orchestration topology as simple as the workload permits.

7. Durable state must exist outside model conversation history.

8. Worker crashes must be expected, observable, and recoverable.

9. Every meaningful factory event should be inspectable afterward.

10. ApplePI should measure whether its changes actually improve outcomes.

11. Avoid adding infrastructure until a measured requirement justifies it.

12. Prefer boring, understandable components over clever abstractions.


============================================================
2. FINAL RESPONSIBILITY BOUNDARIES
============================================================

Use three primary runtime layers.


------------------------------------------------------------
OMP — CODING AGENT
------------------------------------------------------------

OMP owns individual agent intelligence and session behavior:

- model interaction
- coding
- debugging
- repository exploration
- tool execution
- context management
- automatic compaction
- pruning
- overflow recovery
- long-session maintenance
- skills
- extensions
- model configuration
- local Scout / Researcher subagents

Do NOT rebuild OMP context management in ApplePI.

Do NOT copy OMP conversation state into ApplePI's database.

Do NOT make ApplePI another coding-agent harness.


------------------------------------------------------------
AWS CLI Agent Orchestrator — CAO
------------------------------------------------------------

CAO owns generic process/session orchestration:

- launching OMP
- terminating OMP
- tmux
- terminal lifecycle
- session lifecycle
- supervisor/worker communication
- dispatch
- process status
- workflow execution
- workflow resume/recovery
- generic agent lifecycle

Use upstream CAO initially.

Do NOT fork CAO merely because customization is possible.

Fork only if:

    a required primitive is genuinely unavailable
    AND
    it cannot cleanly live in ApplePI.

If a fork becomes necessary:

- keep it minimal;
- keep changes generic;
- stay close to upstream;
- never put ApplePI factory policy inside the CAO fork.


------------------------------------------------------------
APPLEPI — SOFTWARE FACTORY
------------------------------------------------------------

ApplePI owns software-production semantics:

- engineering objectives
- task decomposition
- task DAG
- task contracts
- task lifecycle
- dependency enforcement
- scheduling
- worker allocation
- worktree ownership
- deterministic verification
- repair policy
- escalation
- integration
- reconciliation
- factory durability
- failure classification
- traces
- experiments
- Harbor evaluation
- model/harness comparisons

ApplePI is the factory.

OMP is the worker.

CAO keeps workers running and coordinated.


============================================================
3. TOOLING POLICY
============================================================

Everything ApplePI itself owns should default to:

    Bun
    TypeScript
    tsc
    bun:sqlite

Python is allowed where an external Python interface requires it,
especially Harbor adapters and analysis scripts.

Do NOT introduce into ApplePI-owned application code:

    npm
    pnpm
    yarn
    npx
    ts-node
    tsx
    Jest
    Vitest
    Redis
    Postgres
    Temporal
    Kafka
    separate task runners

unless a concrete requirement appears later.


Standard commands:

    bun install

    bun test

    tsc --noEmit

    bun run check


Expected package.json behavior:

    "check":
        typecheck + tests

Keep package.json a thin command registry.


External dependencies may use their own native technology:

    CAO       Python
    Harbor    Python
    OMP       Bun / TypeScript
    Git
    tmux
    Docker

Do not rewrite external projects solely for language uniformity.


============================================================
4. PRESERVE THE OLD GAS CITY IMPLEMENTATION
============================================================

Do NOT destroy previous work.

Before restructuring:

1. Preserve the current Gas City implementation on its existing branch:

    phase0-pi-codex   (already pushed to origin/phase0-pi-codex)

   The branch is the archive; no archive/ directory is created.

2. Document why Gas City was left behind:

    the note below, plus short bullets in the README.

3. Create a new branch:

    v2-cao-omp-harbor

4. Build ApplePI v2 there.

5. Replace main only after the new foundation has passed its initial
   integration and recovery tests.

Historical work should remain inspectable through Git (branch
phase0-pi-codex).

Do NOT carry Gas City abstractions into v2 merely because they already exist.

Why we left Gas City
--------------------

- Too dangerous security-wise: Gas City injected into the agent — untrusted
  content (bead/issue/PR/repo text) fed straight into the agent's context,
  plus its own session/runtime hooks in the running agent. That injection
  path enabled arbitrary command execution with full user privileges.
- Too many technical moving parts that complicated the project.


============================================================
5. REMOVE OBSOLETE ARCHITECTURAL DEPENDENCIES
============================================================

ApplePI v2 should no longer depend on:

    Gas City
    Beads
    bd
    Dolt

Remove current assumptions around:

    rigs
    sling
    molecules
    Gas City role packs
    Gas City formulas
    Gas City task identity
    Gas City recovery
    Gas City worktree ownership

Preserve worthwhile historical documentation: the why-we-left rationale
lives in the README and in the note in §4 of this roadmap; the old
implementation is preserved on branch `phase0-pi-codex`. No `docs/archive/`
directory is created.

README.md must describe the current system only.
Never present old architecture as active architecture.


============================================================
6. TARGET ARCHITECTURE
============================================================

Conceptually:

                         HUMAN
                           │
                           ▼
                    ┌─────────────┐
                    │   ApplePI   │
                    │ Bun + TS    │
                    └──────┬──────┘
                           │
                    objective/task DAG
                           │
                           ▼
                    ┌─────────────┐
                    │     CAO     │
                    │             │
                    │ lifecycle   │
                    │ sessions    │
                    │ dispatch    │
                    │ recovery    │
                    └──────┬──────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
               OMP        OMP        OMP
             Worker A   Worker B   Worker C
                │          │          │
           worktree A worktree B worktree C
                │          │          │
                └──────────┼──────────┘
                           ▼
                   ApplePI Verifier
                       /       \
                    PASS       FAIL
                     │           │
                 integrate      repair
                                  │
                                  └────→ OMP


Factory-level durable state:

                         SQLite
                           ▲
                           │
                        ApplePI

OMP context remains inside OMP.

CAO runtime/session state remains inside CAO.

ApplePI stores software-factory state.


============================================================
7. TARGET REPOSITORY LAYOUT
============================================================

Keep this one Bun project.

Suggested structure:

applePI/
├── src/
│   ├── cli.ts
│   │
│   ├── factory/
│   │   ├── factory.ts
│   │   ├── objective.ts
│   │   ├── task.ts
│   │   └── states.ts
│   │
│   ├── runtime/
│   │   ├── agent-runtime.ts
│   │   └── cao-runtime.ts
│   │
│   ├── persistence/
│   │   ├── database.ts
│   │   ├── schema.ts
│   │   └── migrations.ts
│   │
│   ├── scheduling/
│   │   ├── scheduler.ts
│   │   └── capacity.ts
│   │
│   ├── worktrees/
│   │   └── worktree-manager.ts
│   │
│   ├── verification/
│   │   ├── verifier.ts
│   │   ├── result.ts
│   │   ├── command.ts
│   │   ├── files.ts
│   │   └── diff.ts
│   │
│   ├── repair/
│   │   ├── repair-policy.ts
│   │   └── escalation.ts
│   │
│   ├── integration/
│   │   ├── integrator.ts
│   │   └── project-verification.ts
│   │
│   ├── tracing/
│   │   ├── events.ts
│   │   ├── trace-writer.ts
│   │   └── failure-classification.ts
│   │
│   └── evals/
│       ├── experiment.ts
│       ├── metrics.ts
│       └── comparison.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── recovery/
│   └── fixtures/
│
├── bench/
│   └── harbor/
│       ├── agent/
│       │   └── applepi_agent.py
│       ├── datasets/
│       │   ├── smoke/
│       │   └── applepi-long-horizon/
│       └── run.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── RECOVERY.md
│   ├── HARBOR.md
│   └── EVALS.md
│
├── package.json
├── bun.lock
├── tsconfig.json
└── README.md


Do NOT split this into many packages prematurely.


============================================================
8. PHASE 0 — FREEZE AND PROVE THE NEW FOUNDATION
============================================================

Do not build advanced factory logic first.

Prove:

    CAO
      +
    OMP
      +
    tmux
      +
    Git worktrees

function reliably together.


------------------------------------------------------------
8.1 PIN DEPENDENCIES
------------------------------------------------------------

Record exact versions or commits of:

    CAO
    OMP
    pi-interactive-subagents
    Harbor

Store these in:

    docs/ARCHITECTURE.md

Do not build reproducibility around "latest."


------------------------------------------------------------
8.2 CAO + OMP SMOKE TEST
------------------------------------------------------------

Use CAO's existing OMP support.

Verify:

[ ] CAO launches OMP

[ ] OMP loads its normal model configuration

[ ] OMP retains tools

[ ] OMP retains extensions

[ ] OMP retains skills

[ ] OMP retains context management

[ ] OMP retains automatic compaction

[ ] CAO can provide a specific working directory

[ ] CAO can observe worker lifecycle

[ ] CAO can terminate a worker

[ ] worker disappearance does not corrupt CAO workflow state


Do NOT modify CAO during this test.


------------------------------------------------------------
8.3 TWO-WORKER TEST
------------------------------------------------------------

Create disposable fixture repo.

Create:

    worktree-a
    worktree-b

Launch:

    Worker A → worktree-a

    Worker B → worktree-b

Give them independent engineering tasks.

Verify:

[ ] both execute simultaneously

[ ] neither edits the other's worktree

[ ] both can create valid commits

[ ] both are independently addressable

[ ] lifecycle state remains understandable


------------------------------------------------------------
8.4 OMP COMPACTION TEST
------------------------------------------------------------

Create one deliberately long-running worker session.

Generate enough tool usage/context for OMP maintenance to trigger.

Verify:

[ ] OMP compacts normally

[ ] worker continues engineering correctly

[ ] CAO does not interpret compaction as completion

[ ] no ApplePI task state depends on context size

[ ] worker remains usable after compaction


OMP context maintenance is explicitly an OMP responsibility.


------------------------------------------------------------
8.5 INTERACTIVE SUBAGENT TEST
------------------------------------------------------------

Test pi-interactive-subagents under OMP unchanged first.

Test:

    Worker
      ├── Scout
      └── Researcher

Verify:

[ ] spawn

[ ] parallel spawn

[ ] steering

[ ] ask_question

[ ] result returns to Worker

[ ] session resume

[ ] tool restrictions

[ ] read-only Scout behavior

Do NOT fork or port it unless a real incompatibility is found.


============================================================
9. PHASE 0B — HARBOR BASELINE
============================================================

Harbor evaluation should exist near the beginning.

Before ApplePI orchestration changes worker behavior,
establish a baseline for OMP alone.

Use OMP's existing Harbor integration as the reference implementation.

Do not rewrite OMP's benchmark runner unless necessary.


------------------------------------------------------------
9.1 FIRST BASELINE
------------------------------------------------------------

Use a small frozen subset.

Start:

    5 tasks

Then:

    10 tasks

Use:

    1 attempt per task

Pin:

    Harbor version
    dataset version
    task IDs
    OMP version
    model
    thinking level
    relevant configuration


Record:

    pass/fail
    wall time
    tokens
    cost where available
    errors
    benchmark job identifier/path


Create:

    docs/evals/omp-baseline.md


This becomes the control:

    OMP ALONE


Later compare against:

    APPLEPI + SAME OMP


============================================================
10. PHASE 1 — APPLEPI BUN SKELETON
============================================================

Create:

    package.json
    bun.lock
    tsconfig.json
    src/
    tests/


Required scripts:

    bun run dev
    bun run typecheck
    bun test
    bun run check
    bun run harbor


Where:

    bun run check

means:

    tsc --noEmit
    +
    bun test


Use strict TypeScript.

At minimum:

    strict
    noUncheckedIndexedAccess


============================================================
11. PHASE 2 — AGENT RUNTIME INTERFACE
============================================================

Do NOT let CAO leak throughout ApplePI.

Define a small interface:

interface AgentRuntime {
    startWorker(...)
    send(...)
    wait(...)
    getStatus(...)
    stop(...)
    resume(...)
}

First implementation:

    CaoRuntime


ApplePI should depend on:

    AgentRuntime

not:

    CAO command strings everywhere.


This gives us an escape hatch if CAO becomes limiting later.


============================================================
12. PHASE 3 — DURABLE APPLEPI STATE
============================================================

Create ApplePI-owned persistence using:

    bun:sqlite


Do not duplicate CAO's database.

Do not duplicate OMP session storage.

ApplePI stores software-factory state only.


Initial tables:

    objectives
    tasks
    task_dependencies
    attempts
    verifier_results
    events


============================================================
13. OBJECTIVE MODEL
============================================================

Objective approximately contains:

    id
    instruction
    repository
    base_commit
    state
    created_at
    updated_at


Initial states:

    planning
    running
    integrating
    completed
    failed
    cancelled


============================================================
14. TASK MODEL
============================================================

Do not implement task state as:

    status: string

plus dozens of nullable properties.

Use discriminated unions and explicit state transitions where practical.


Task states:

    queued
    blocked
    ready
    running
    verifying
    repairing
    completed
    failed
    cancelled


A Task approximately contains:

    id
    objective_id
    title
    objective
    context
    dependencies
    current_state
    assigned_worker
    worktree
    base_commit
    attempt_count
    verifier_spec


Factory state is authoritative.

OMP is never the authoritative task store.


============================================================
15. PHASE 4 — EXECUTIVE → TASK DAG
============================================================

Start topology with:

    Human
      ↓
    Executive
      ↓
    Workers


Do NOT add Managers initially.


Executive receives:

    engineering objective
    repository context

and proposes structured tasks.


Example conceptual output:

{
    "tasks": [
        {
            "id": "schema",
            "objective": "...",
            "dependencies": [],
            "verification": [...]
        },
        {
            "id": "api",
            "objective": "...",
            "dependencies": ["schema"],
            "verification": [...]
        }
    ]
}


ApplePI validates before persisting.


Validate:

[ ] task IDs unique

[ ] every dependency exists

[ ] DAG is acyclic

[ ] number of tasks is bounded

[ ] required fields exist

[ ] verifier specification is valid


The model proposes.

The runtime validates.


============================================================
16. PHASE 5 — WORKTREE MANAGER
============================================================

Every concurrent implementation task receives its own Git worktree.

Suggested:

    .applepi/worktrees/<task-id>/


ApplePI owns:

    worktree creation
    branch naming
    base commit
    task → worktree mapping
    cleanup
    recovery
    integration preparation


Initial maximum workers:

    4


Do not start with huge fleets.


Acceptance:

[ ] two workers cannot share the same task worktree

[ ] wrong cwd is detected

[ ] abandoned worktree is recoverable

[ ] base SHA is recorded

[ ] cleanup is deterministic


============================================================
17. PHASE 6 — DETERMINISTIC VERIFICATION
============================================================

Worker completion does NOT close a task.

Worker completion transitions:

    running
        ↓
    verifying


Initial verifier types:

    command
    tests
    typecheck
    build
    required file
    forbidden file
    forbidden path
    diff scope
    custom executable


For Bun/TS projects where appropriate:

    bun test
    tsc --noEmit
    bun run build


For external benchmark repositories:

run the repository's legitimate deterministic checks.

Do not force Bun on third-party target repos.


Structured verifier result:

{
    "verifier": "typecheck",
    "status": "failed",
    "command": "tsc --noEmit",
    "exitCode": 2,
    "durationMs": 842,
    "category": "TYPECHECK_FAILED",
    "relevantOutput": [
        "src/foo.ts:73..."
    ]
}


Never return only:

    false


============================================================
18. PHASE 7 — AUTOMATIC REPAIR LOOP
============================================================

Implement:

    implementation
        ↓
    verification
        ↓
      failure
        ↓
    structured failure packet
        ↓
    repair
        ↓
    verification


Reuse the same OMP worker session while it remains healthy.

Reason:

it already has task-specific context.


Failure packet contains:

    failed verifier
    command
    exit code
    relevant output
    attempt number
    changed files
    current Git state


Default:

    maximum 3 implementation attempts


After threshold:

    escalate to Executive


Executive may:

    replace worker
    split task
    revise decomposition
    request human clarification
    abandon task


Never automatically weaken verifier criteria because the worker cannot satisfy them.


============================================================
19. PHASE 8 — CRASH RECOVERY
============================================================

Failure injection must become part of normal testing.


Test:

A. Kill OMP worker mid-task.

Expected:

    task survives
    worktree survives
    attempt becomes interrupted
    replacement worker can continue


B. Kill tmux pane.

Expected:

    same


C. Restart ApplePI.

Expected:

    objective and task state reconstructed from SQLite


D. Restart CAO.

Expected:

    ApplePI reconciles runtime state


E. Provider/API failure.

Expected:

    bounded retry
    classified failure


F. Verifier hangs.

Expected:

    verifier process timeout
    process cleanup
    VERIFIER_TIMEOUT


G. Context compaction occurs.

Expected:

    no effect on factory task semantics


H. Worker dies after modifying files but before completion.

Expected:

    repository state remains inspectable
    task can resume from actual worktree state


============================================================
20. RECONCILIATION
============================================================

ApplePI should not blindly trust cached runtime state.

On startup/recovery reconcile:

    SQLite task state
    CAO session state
    process state
    worktree state
    Git state


Example:

SQLite says:

    task = running

but CAO worker no longer exists.

ApplePI should detect:

    orphaned running task

and apply recovery policy.


Do not silently mark it complete.


============================================================
21. PHASE 9 — PARALLEL SCHEDULER
============================================================

Implement deterministic bounded scheduling.


Ready task condition:

    task state = ready

    AND

    all dependencies completed

    AND

    capacity available


Initial:

    maxWorkers = 4


The Executive may create task structure.

The runtime determines which tasks are runnable.


Do not ask an LLM:

    "Which ready task should execute now?"

when a deterministic scheduler can answer.


============================================================
22. PHASE 10 — LOCAL OMP SUBAGENTS
============================================================

Once Worker execution is stable, enable local Scout/Researcher assistance.


Global scheduling:

    ApplePI
       ├── Worker A
       ├── Worker B
       └── Worker C


Local assistance:

    Worker A
       ├── Scout
       └── Researcher


Scouts:

    read-only repository reconnaissance


Researchers:

    external/documentation research


Worker:

    owns implementation


Local subagents are NOT global task owners.

Do not create a second scheduler through nested subagents.


============================================================
23. PHASE 11 — STRUCTURED TRACING
============================================================

Every objective should generate:

    .applepi/runs/<run-id>/trace.jsonl

and:

    .applepi/runs/<run-id>/summary.json


Do NOT log hidden chain-of-thought.


Log observable operational events:

    ObjectiveStarted
    PlanCreated
    TaskCreated
    TaskReady
    WorkerStarted
    WorkerStopped
    WorkerCrashed
    VerificationStarted
    VerificationFailed
    RepairStarted
    VerificationPassed
    IntegrationStarted
    IntegrationFailed
    TaskCompleted
    ObjectiveCompleted


Useful fields:

    timestamp
    objective_id
    task_id
    attempt_id
    worker_id
    model
    duration
    failure category
    verifier
    commit
    changed files where appropriate


============================================================
24. PHASE 12 — FAILURE TAXONOMY
============================================================

Start small:

    PLAN_INVALID
    PLAN_INCOMPLETE
    TOOL_FAILURE
    AGENT_CRASH
    PROVIDER_FAILURE
    TYPECHECK_FAILED
    TEST_FAILED
    BUILD_FAILED
    SCOPE_VIOLATION
    INCOMPLETE_IMPLEMENTATION
    VERIFIER_TIMEOUT
    MERGE_CONFLICT
    INTEGRATION_FAILED
    MAX_ATTEMPTS
    UNKNOWN


Add categories only after real failures justify them.


The goal is eventually to answer:

    What failure classes dominate the factory?


============================================================
25. PHASE 13 — INTEGRATION ENGINE
============================================================

Task-level success is insufficient.


Workflow:

    task verifier passes
        ↓
    branch becomes integration candidate
        ↓
    dependency-safe integration
        ↓
    project-wide verification
        ↓
    PASS / FAIL


Project-wide verification may include:

    full tests
    full typecheck
    full build
    targeted integration tests


If integration fails:

    preserve worker branches
    preserve verifier evidence
    classify failure
    create integration repair task


Never silently merge broken output.


============================================================
26. PHASE 14 — APPLEPI HARBOR AGENT
============================================================

Make the entire factory runnable as one Harbor agent.


Harbor sees:

    benchmark instruction
          ↓
    ApplePIAgent
          ↓
    ApplePI
          ↓
    CAO
          ↓
    multiple OMP workers


Create:

    bench/harbor/agent/applepi_agent.py


This file should be thin.

Python exists here because Harbor expects a Python agent class.


The Harbor adapter should NOT contain:

    task decomposition logic
    scheduling logic
    verification policy
    recovery policy


Those belong in TypeScript ApplePI.


------------------------------------------------------------
APPLEPIAGENT SETUP
------------------------------------------------------------

Prepare:

    Bun
    ApplePI source
    CAO
    OMP
    tmux
    Git

Configure:

    model routing
    required credentials
    task environment


------------------------------------------------------------
APPLEPIAGENT RUN
------------------------------------------------------------

Invoke roughly:

    bun run src/cli.ts run \
        --instruction "<task>" \
        --repo <task cwd> \
        --headless \
        --max-workers 4 \
        --trace /logs/agent/applepi/trace.jsonl \
        --summary /logs/agent/applepi/summary.json


Wait for terminal objective state.


Harbor's verifier decides whether benchmark work actually passed.

ApplePI should not self-award benchmark success.


============================================================
27. REUSE OMP'S EXISTING HARBOR IMPLEMENTATION
============================================================

Study existing OMP Harbor code before writing ApplePI's adapter.

Reuse patterns for:

    OMP installation
    Bun setup
    local source testing
    credentials
    model routing
    Harbor logs
    token counting
    cost aggregation
    Docker environment behavior


Do NOT blindly copy the entire metaharness.

Reuse the smallest proven pieces necessary.


============================================================
28. PHASE 15 — APPLEPI HARBOR SMOKE
============================================================

Run exactly the same frozen tasks as the OMP-only baseline.


Control:

    OMP alone


Candidate:

    ApplePI + OMP


Keep constant:

    model
    thinking level
    task set
    benchmark version
    relevant OMP configuration


Start:

    Harbor concurrency = 1

    ApplePI max workers = 2


Then:

    Harbor concurrency = 1

    ApplePI max workers = 4


Only later run multiple ApplePI factories concurrently.


Compare:

    pass rate
    wall-clock time
    tokens
    cost
    verifier failures
    repairs
    worker count
    crashes
    recoveries


============================================================
29. DO NOT GAME HARBOR
============================================================

Never:

    special-case benchmark task names
    special-case task IDs
    inspect hidden verifier logic from the agent
    encode known benchmark solutions
    weaken isolation
    change behavior when detecting Terminal-Bench
    inject benchmark-specific hints


Harbor exists to test the factory.

Do not turn the factory into a Harbor-score optimizer.


============================================================
30. PHASE 16 — APPLEPI-SPECIFIC HARBOR DATASET
============================================================

General coding benchmarks are useful but not sufficient.

Create:

    bench/harbor/datasets/applepi-long-horizon/


The custom suite should specifically stress factory behavior.


------------------------------------------------------------
TASK CLASS A — PARALLEL WORK
------------------------------------------------------------

Four independent broken modules.

Single high-level objective asks to repair all four.

Tests:

    decomposition
    concurrency
    isolation
    integration


------------------------------------------------------------
TASK CLASS B — DEPENDENCY DAG
------------------------------------------------------------

Example:

    schema
       ↓
    backend
       ↓
    frontend

plus independent tests/docs where useful.

Verify execution respects dependencies.


------------------------------------------------------------
TASK CLASS C — REPAIR LOOP
------------------------------------------------------------

Initial implementation path predictably fails deterministic verification.

Factory should:

    detect
    explain
    repair
    pass


------------------------------------------------------------
TASK CLASS D — WORKER CRASH
------------------------------------------------------------

Deliberately terminate a worker mid-task.

Factory must recover.


------------------------------------------------------------
TASK CLASS E — INTEGRATION REGRESSION
------------------------------------------------------------

Two branches individually pass.

Combined result fails project-level verifier.

Factory must detect and repair.


------------------------------------------------------------
TASK CLASS F — LONG CONTEXT
------------------------------------------------------------

Require enough exploration/work to trigger OMP context maintenance.

Verify successful continuation.


------------------------------------------------------------
TASK CLASS G — LOCAL PASS, GLOBAL FAIL
------------------------------------------------------------

Worker's local tests pass.

Full project verification fails.

Integration gate must reject completion.


------------------------------------------------------------
TASK CLASS H — SCOPE VIOLATION
------------------------------------------------------------

Tempting implementation changes a forbidden area.

Scope verifier should reject it.


------------------------------------------------------------
TASK CLASS I — LONG-HORIZON OBJECTIVE
------------------------------------------------------------

Many dependencies, repairs, handoffs and integration stages.

Start with:

    20–40 minute tasks

Eventually include:

    multi-hour tasks


============================================================
31. HARBOR TASK QUALITY
============================================================

Every custom task should have:

    deterministic verifier
    reproducible environment
    clear task instruction
    reasonable timeout
    explicit resource limits
    reference/oracle solution
    repeatable pass/fail behavior


Before using a task for comparison:

    run the oracle repeatedly


If the oracle is flaky:

    fix the task

Do not blame the factory.


============================================================
32. PHASE 17 — EXPERIMENT SYSTEM
============================================================

Treat factory changes as experiments.


Freeze:

    ApplePI commit
    CAO version
    OMP version
    Harbor version
    dataset
    task IDs
    model
    thinking
    worker count
    repair policy
    verifier configuration


Then change ONE major dimension.


Examples:

Experiment 001

    OMP alone

vs

    ApplePI + OMP


Experiment 002

    maxWorkers = 1

vs

    maxWorkers = 4


Experiment 003

    repairAttempts = 1

vs

    repairAttempts = 3


Experiment 004

    Scout disabled

vs

    Scout enabled


Experiment 005

    Model A

vs

    Model B


Do not change model, harness and dataset simultaneously and claim causality.


============================================================
33. METRICS
============================================================

Primary:

    objective success rate


Secondary:

    task verifier pass rate
    integration pass rate
    attempts to success
    repair count
    wall-clock duration
    worker utilization
    tokens
    cost
    crashes
    recovery success
    merge conflicts
    failure categories


Derived:

    success / dollar
    success / minute
    recovery success rate
    success after first verification failure


Do not optimize noisy metrics prematurely.


============================================================
34. REGRESSION SYSTEM
============================================================

For meaningful ApplePI changes:

    baseline commit
          ↓
    frozen Harbor workload
          ↓
    candidate commit


Report:

    unchanged passes
    new passes
    regressions
    unchanged failures


Example:

    +3 new passes
    -1 regression
    6 unchanged passes
    10 unchanged failures


Do not hide regressions behind one aggregate score.


Store curated experiment summaries:

    docs/evals/
        omp-baseline.md
        experiment-001.md
        experiment-002.md


Do not commit gigantic raw run directories unless needed.


============================================================
35. PHASE 18 — ADAPTIVE TOPOLOGY
============================================================

Do not introduce Managers automatically.


Initial:

    Human
      ↓
    Executive
      ↓
    Workers


Only experiment with:

    Executive
      ↓
    Managers
      ↓
    Workers

when actual long-horizon workloads show coordination pressure.


Possible topology policy later:

small:

    Executive → Worker


medium:

    Executive → Workers


large:

    Executive → Managers → Workers


Topology must remain an implementation choice.

Not a mandatory organizational ritual.


Use Harbor experiments to determine whether Manager layers improve:

    completion
    cost
    wall time
    error rate
    coordination


============================================================
36. PHASE 19 — MULTI-HOUR FACTORY TEST
============================================================

Choose one objective intentionally expected to take hours.


Requirements:

[ ] multiple tasks

[ ] dependencies

[ ] parallel workers

[ ] deterministic verification

[ ] at least one failed verifier

[ ] repair loop

[ ] worker termination injected

[ ] ApplePI restart injected

[ ] CAO restart tested

[ ] OMP context compaction occurs

[ ] final integration verification


The objective must still complete correctly.


Record:

    total time
    task timeline
    worker timeline
    failures
    repair attempts
    recovery events
    final project verifier
    token usage
    cost
    resulting Git history


============================================================
37. TERMINAL OPERATOR EXPERIENCE
============================================================

Stay terminal-first.


Use CAO/tmux for actual worker panes.

ApplePI should provide a concise factory status surface.


Example:

APPLEPI RUN 01J...

Objective:
    Add team permissions system

Tasks:
    8 total
    2 running
    1 verifying
    2 ready
    1 blocked
    2 completed

Workers:
    auth-worker       running       06:32
    schema-worker     verifying     03:41

Failures:
    TYPECHECK_FAILED  1
    TEST_FAILED       2

Repairs:
    2

Elapsed:
    00:18:43


Do not build a web dashboard until terminal operation actually becomes limiting.


============================================================
38. SECURITY / CONTAINMENT
============================================================

OMP and extensions execute real code.

Treat them accordingly.


For workers:

    task-specific worktree
    explicit cwd
    bounded environment
    secrets isolation
    process timeout
    verifier timeout
    minimal credentials
    no access to unrelated worktrees where practical


For Harbor:

    container isolation
    only required credentials forwarded
    no broad host-secret exposure
    no unrelated filesystem mounts


Third-party extensions are executable dependencies.

Pin and review them.


============================================================
39. README REWRITE
============================================================

README should open with:

    ApplePI is a long-horizon software factory built around durable work,
    isolated coding agents, deterministic verification, recovery, and
    empirical evaluation.


Show:

    Human
      ↓
    ApplePI
      ↓
    CAO
      ↓
    OMP Workers
      ↓
    isolated worktrees
      ↓
    verifier
      ↓
    repair / integration


README sections:

1. What ApplePI is
2. Why it exists
3. Architecture
4. Responsibility boundaries
5. Quickstart
6. Current status
7. Harbor evaluation
8. Recovery guarantees
9. Development
10. Roadmap


Never claim roadmap functionality is already implemented.


============================================================
40. REQUIRED DOCUMENTATION
============================================================

Create:

docs/ARCHITECTURE.md

    current implemented architecture only


docs/ROADMAP.md

    planned work


docs/RECOVERY.md

    failure and recovery semantics


docs/HARBOR.md

    exact benchmark instructions


docs/EVALS.md

    experiment methodology


docs/archive/gascity/ is intentionally NOT created: the old Gas City
implementation is preserved on branch `phase0-pi-codex` (pushed to origin),
and the why-we-left rationale lives in the README and in §4 of this roadmap.


============================================================
41. V2 FOUNDATION SUCCESS CRITERIA
============================================================

Before adding sophisticated hierarchy, all of these must be true:

[ ] CAO reliably launches OMP

[ ] multiple OMP workers can run concurrently

[ ] workers use separate worktrees

[ ] OMP context compaction works during long tasks

[ ] ApplePI has durable SQLite objective/task state

[ ] task dependencies work

[ ] deterministic verification controls completion

[ ] failed verification produces repair

[ ] worker crash does not lose the task

[ ] ApplePI restart does not lose the objective

[ ] CAO runtime loss can be reconciled

[ ] final integration verification exists

[ ] traces are persisted

[ ] OMP-only Harbor baseline exists

[ ] ApplePI Harbor adapter exists

[ ] same frozen Harbor tasks run through both configurations

[ ] real benchmark numbers are recorded

[ ] no benchmark-specific hacks exist


============================================================
42. IMPLEMENTATION ORDER
============================================================

Follow this order.

Do not skip forward because later features are more interesting.

1. Preserve Gas City history (branch `phase0-pi-codex`, already pushed;
   no archive directories).

2. Create v2-cao-omp-harbor branch.

3. Rewrite README + architecture docs.

4. Pin dependencies.

5. Prove CAO + OMP.

6. Prove two concurrent OMP sessions.

7. Prove isolated worktrees.

8. Prove OMP compaction during a real task.

9. Test Amos subagents under OMP.

10. Establish OMP-only Harbor baseline.

11. Create Bun/TypeScript ApplePI skeleton.

12. Implement AgentRuntime abstraction.

13. Implement CaoRuntime.

14. Implement bun:sqlite persistence.

15. Implement Objective model.

16. Implement Task model/state machine.

17. Implement DAG validation.

18. Implement worktree manager.

19. Implement one Worker task end-to-end.

20. Implement deterministic verifier.

21. Implement failure → repair loop.

22. Implement bounded parallel scheduler.

23. Implement structured traces.

24. Implement failure classification.

25. Implement crash recovery/reconciliation.

26. Implement integration engine.

27. Implement ApplePI Harbor adapter.

28. Run same Harbor baseline through ApplePI.

29. Compare ApplePI against OMP alone.

30. Create custom applepi-long-horizon Harbor dataset.

31. Run failure-injection Harbor cases.

32. Measure local subagent value.

33. Experiment with alternative models.

34. Experiment with worker counts.

35. Experiment with Manager topology only if needed.

36. Perform real multi-hour run.

37. Simplify architecture based on measured results.

38. Polish terminal operator experience.

39. Document actual measured behavior.

40. Merge v2 into main.


============================================================
43. ENGINEERING RULES
============================================================

Do NOT:

- rebuild OMP;
- rebuild CAO;
- fork CAO without evidence;
- port Amos's extension without testing compatibility first;
- recreate OMP context compaction;
- introduce Beads;
- introduce Gas City;
- introduce Dolt;
- build another workflow framework;
- add Redis/Postgres/Temporal prematurely;
- use npm/pnpm/yarn for ApplePI;
- build a web dashboard early;
- force Manager hierarchy;
- trust an agent's claim that work is correct;
- use LLM-as-judge where deterministic checks are possible;
- special-case benchmark tasks;
- fabricate eval numbers;
- hide regressions;
- claim planned features are complete.


Prefer:

    small interfaces
    explicit state machines
    strict TypeScript
    durable state
    isolated worktrees
    bounded concurrency
    structured errors
    deterministic verification
    reproducible experiments
    failure injection
    simple architecture
    measurable improvements


============================================================
44. FINAL DESIGN PHILOSOPHY
============================================================

ApplePI should not succeed because its prompts are clever.

It should succeed because the complete system is engineered well.

The model handles:

    ambiguity
    reasoning
    implementation
    debugging

The runtime handles:

    state
    ownership
    concurrency
    recovery
    isolation
    retries

The verifier handles:

    correctness gates

Git handles:

    durable code artifacts

OMP handles:

    individual-agent context and intelligence

CAO handles:

    agent lifecycle

Harbor handles:

    measurement

ApplePI ties those components together into a durable software-production
system.

The model proposes.

The runtime constrains.

The verifier decides.

The work survives.

Harbor measures.

