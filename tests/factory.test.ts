import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaseAInstruction, runObjective, type Io } from "../src/factory";
import type { Phase, WorkerHandle, WorkerResult } from "../src/cao-runtime";
import { openDatabase, type Objective, type Task } from "../src/database";
import type { VerifierResult } from "../src/verifier";

function git(dir: string, args: string[]): string {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  if (!proc.success) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

function initRepo(dir: string): string {
  git(dir, ["init", "-b", "main"]);
  writeFileSync(join(dir, ".gitignore"), ".applepi/\n");
  writeFileSync(join(dir, "file.txt"), "base\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

const io: Io = {
  isTTY: true,
  readAnswer: async () => "1",
  print: () => {},
};

test("phaseAInstruction embeds the human objective verbatim and never a roadmap shortcut", () => {
  const objective =
    "Inspect src/verifier.ts and propose a bounded fix for command timeout handling.";
  const instruction = phaseAInstruction("/tmp/repo", objective);
  expect(instruction).toContain(objective);
  expect(instruction).toContain("/tmp/repo");
  expect(instruction).toContain("HUMAN OBJECTIVE:");
  expect(instruction).toContain("This human objective is authoritative.");
  expect(instruction).toContain("clarification/request.json");
  expect(instruction).toContain("Do not modify any tracked files.");
});

test("durability boundary: task rows exist before B2 execution; a B2 crash fails them all", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "applepi-factory-durable-"));
  try {
    initRepo(fixture);
    const objectiveText = "Implement a bounded change for the durability test.";

    class FakeRuntime {
      async startWorker(input: { cwd: string; phase: Phase; instruction: string }) {
        if (input.phase === "a") {
          mkdirSync(join(input.cwd, ".applepi", "clarification"), { recursive: true });
          writeFileSync(
            join(input.cwd, ".applepi", "clarification", "request.json"),
            JSON.stringify({
              questions: [{ question: "Which direction?", choices: ["option one", "option two"] }],
            }),
          );
        } else if (input.phase === "b1") {
          writeFileSync(
            join(input.cwd, ".applepi", "segments.json"),
            JSON.stringify([
              { instruction: "segment one instruction", commit_prefix: "applepi-task-1:" },
              { instruction: "segment two instruction", commit_prefix: "applepi-task-2:" },
            ]),
          );
        } else {
          throw new Error("B2 throws before worker execution");
        }
        return { sessionName: `fake-${input.phase}` };
      }
      async wait(_worker: WorkerHandle): Promise<WorkerResult> {
        return { ok: true, state: "completed", detail: "" };
      }
      async stopServer(): Promise<void> {}
    }

    const code = await runObjective(fixture, objectiveText, io, new FakeRuntime() as never);
    expect(code).toBe(1);

    const db = openDatabase(fixture);
    const objectives = db.query("SELECT * FROM objectives").all() as Objective[];
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.state).toBe("failed");
    expect(objectives[0]!.instruction).toBe(objectiveText);

    const tasks = db.query("SELECT * FROM tasks").all() as Task[];
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.objective_id).toBe(objectives[0]!.id);
      expect(task.state).toBe("failed");
      expect(task.worktree_path).not.toBeNull();
    }
    expect(tasks.map((t) => t.instruction).sort()).toEqual([
      "segment one instruction",
      "segment two instruction",
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("integration failure fails the objective and task and leaves no cherry-pick state", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "applepi-factory-integrate-"));
  try {
    initRepo(fixture);
    const objectiveText = "Implement a bounded change for the integration test.";

    class FakeRuntime {
      readonly repoPath: string;
      constructor(repoPath: string) {
        this.repoPath = repoPath;
      }
      async startWorker(input: { cwd: string; phase: Phase; instruction: string }) {
        if (input.phase === "a") {
          mkdirSync(join(input.cwd, ".applepi", "clarification"), { recursive: true });
          writeFileSync(
            join(input.cwd, ".applepi", "clarification", "request.json"),
            JSON.stringify({
              questions: [{ question: "Which direction?", choices: ["option one", "option two"] }],
            }),
          );
        } else if (input.phase === "b1") {
          writeFileSync(
            join(input.cwd, ".applepi", "segments.json"),
            JSON.stringify([
              { instruction: "implement the change", commit_prefix: "applepi-task-1:" },
            ]),
          );
        } else {
          // Worker commits in the worktree...
          writeFileSync(join(input.cwd, "file.txt"), "worker change\n");
          git(input.cwd, ["commit", "-am", "applepi-task-1: worker change"]);
          // ...while main advances concurrently after the base capture.
          writeFileSync(join(this.repoPath, "file.txt"), "main change\n");
          git(this.repoPath, ["commit", "-am", "main change"]);
        }
        return { sessionName: `fake-${input.phase}` };
      }
      async wait(_worker: WorkerHandle): Promise<WorkerResult> {
        return { ok: true, state: "completed", detail: "" };
      }
      async stopServer(): Promise<void> {}
    }

    const verifyStub = async (): Promise<VerifierResult> => ({ passed: true, checks: [] });
    const code = await runObjective(
      fixture,
      objectiveText,
      io,
      new FakeRuntime(fixture) as never,
      verifyStub,
    );
    expect(code).toBe(1);

    const db = openDatabase(fixture);
    const objectives = db.query("SELECT * FROM objectives").all() as Objective[];
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.state).toBe("failed");
    expect(objectives[0]!.instruction).toBe(objectiveText);

    const tasks = db.query("SELECT * FROM tasks").all() as Task[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.state).toBe("failed");
    expect(tasks[0]!.worktree_path).not.toBeNull();

    // No CHERRY_PICK_HEAD, clean main, branch and worktree retained.
    const cherryPickHead = Bun.spawnSync(
      ["git", "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"],
      { cwd: fixture, stdout: "pipe", stderr: "pipe" },
    );
    expect(cherryPickHead.success).toBe(false);
    const status = Bun.spawnSync(["git", "status", "--porcelain"], {
      cwd: fixture,
      stdout: "pipe",
    }).stdout.toString();
    expect(status.trim()).toBe("");
    // Worktree-checked-out branches are listed with a "+" prefix.
    expect(git(fixture, ["branch", "--list", "applepi/objective-1"]).trim()).toMatch(
      /^\+? ?applepi\/objective-1$/,
    );
    expect(existsSync(join(fixture, ".applepi", "worktrees", "objective-1"))).toBe(true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("detached HEAD fails fast with no branch created", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "applepi-factory-detached-"));
  try {
    initRepo(fixture);
    git(fixture, ["checkout", "--detach", "HEAD"]);
    class FakeRuntime {
      async startWorker(): Promise<never> {
        throw new Error("must not be called on detached HEAD");
      }
      async wait(_worker: WorkerHandle): Promise<WorkerResult> {
        return { ok: true, state: "completed", detail: "" };
      }
      async stopServer(): Promise<void> {}
    }
    const code = await runObjective(fixture, "detached HEAD test", io, new FakeRuntime() as never);
    expect(code).toBe(1);
    // Guard fires before persistence, so no objective row exists yet.
    const db = openDatabase(fixture);
    const objectives = db.query("SELECT * FROM objectives").all() as Objective[];
    expect(objectives).toHaveLength(0);
    expect(git(fixture, ["branch", "--list", "applepi/*"]).trim()).toBe("");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("non-sequential unique prefixes are accepted", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "applepi-factory-prefixes-"));
  try {
    initRepo(fixture);
    class FakeRuntime {
      async startWorker(input: { cwd: string; phase: Phase; instruction: string }) {
        if (input.phase === "a") {
          mkdirSync(join(input.cwd, ".applepi", "clarification"), { recursive: true });
          writeFileSync(
            join(input.cwd, ".applepi", "clarification", "request.json"),
            JSON.stringify({
              questions: [{ question: "Which direction?", choices: ["option one", "option two"] }],
            }),
          );
        } else if (input.phase === "b1") {
          writeFileSync(
            join(input.cwd, ".applepi", "segments.json"),
            JSON.stringify([
              { instruction: "segment a instruction", commit_prefix: "applepi-task-2:" },
              { instruction: "segment b instruction", commit_prefix: "applepi-task-5:" },
            ]),
          );
        } else {
          throw new Error("B2 throws before worker execution");
        }
        return { sessionName: `fake-${input.phase}` };
      }
      async wait(_worker: WorkerHandle): Promise<WorkerResult> {
        return { ok: true, state: "completed", detail: "" };
      }
      async stopServer(): Promise<void> {}
    }
    const code = await runObjective(fixture, "non-sequential prefixes test", io, new FakeRuntime() as never);
    expect(code).toBe(1);
    const db = openDatabase(fixture);
    const tasks = db.query("SELECT * FROM tasks").all() as Task[];
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.instruction).sort()).toEqual([
      "segment a instruction",
      "segment b instruction",
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
