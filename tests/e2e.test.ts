import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type Objective, type Task } from "../src/database";

const repoRoot = join(import.meta.dir, "..");
const OBJECTIVE =
  "Inspect docs/ROADMAP.md. As ApplePI's executive, follow the latest roadmap item: " +
  "identify the next unfinished §42 item implementable as a bounded change, ask the human " +
  "for clarification, split the work into segments, and complete them via worker subagents.";

function git(fixture: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
  if (!proc.success) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

test.skipIf(!process.env.APPLEPI_E2E)(
  "vertical slice e2e",
  async () => {
    // Fixture: local clone of the repo (default branch v2-cao-omp-harbor) in tests/work/.
    mkdirSync(join(repoRoot, "tests/work"), { recursive: true });
    const fixture = mkdtempSync(join(repoRoot, "tests/work/e2e-"));
    let cleanup = true;
    try {
      git(repoRoot, ["clone", repoRoot, fixture]);
      const base = git(fixture, ["rev-parse", "HEAD"]).trim();

      // Network: install dependencies in the fixture.
      const install = Bun.spawnSync(["bun", "install"], { cwd: fixture, stdout: "pipe", stderr: "pipe" });
      if (!install.success) {
        throw new Error(`bun install failed: ${install.stderr.toString()}`);
      }

      // Run the full CLI flow. APPLEPI_E2E is stripped so worker-side `bun run check`
      // (which runs `bun test` inside the worktree) never recurses into this test.
      const env: Record<string, string | undefined> = { ...process.env };
      delete env.APPLEPI_E2E;
      env.APPLEPI_CLARIFY_ANSWER = "Proceed with your proposal.";
      const proc = Bun.spawn(
        ["bun", "run", "applepi", "run", "--repo", fixture, "--objective", OBJECTIVE],
        { cwd: fixture, env, stdout: "pipe", stderr: "pipe" },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (exitCode !== 0) {
        throw new Error(
          `applepi run exited ${exitCode}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
        );
      }

      // Durable state: objective completed, tasks completed with commit + worktree.
      const db = openDatabase(fixture);
      const objectives = db.query("SELECT * FROM objectives").all() as Objective[];
      expect(objectives.some((o) => o.state === "completed")).toBe(true);
      const tasks = db.query("SELECT * FROM tasks").all() as Task[];
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      const completed = tasks.filter((t) => t.state === "completed");
      expect(completed.length).toBeGreaterThanOrEqual(1);
      for (const task of completed) {
        expect(task.commit_sha).not.toBeNull();
        expect(task.worktree_path).not.toBeNull();
      }

      // Objective ↔ task linkage: the completed objective is the human-objective
      // row, and every completed task belongs to it (no stray rows).
      expect(objectives.some((o) => o.instruction === OBJECTIVE && o.state === "completed")).toBe(
        true,
      );
      const objectiveId = objectives.find((o) => o.instruction === OBJECTIVE)!.id;
      for (const task of tasks) {
        if (task.state === "completed") expect(task.objective_id).toBe(objectiveId);
      }

      // Worker commits integrated: every completed task's sha is a commit in
      // base..HEAD whose subject starts with applepi-task-<n>:, and HEAD descends from base.
      expect(git(fixture, ["status", "--porcelain"]).trim()).toBe("");
      expect(git(fixture, ["merge-base", "--is-ancestor", base, "HEAD"]).trim()).toBe("");
      const subjects = git(fixture, ["log", "--format=%s", `${base}..HEAD`]).split("\n");
      expect(subjects.some((s) => /^applepi-task-\d+:/.test(s))).toBe(true);
      for (const task of completed) {
        const sha = task.commit_sha!;
        const subject = git(fixture, ["log", "-1", "--format=%s", sha]).trim();
        expect(subject).toMatch(/^applepi-task-\d+:/);
        expect(subjects).toContain(subject);
      }

      // Success cleans up: no applepi worktree and no applepi branch remain.
      expect(git(fixture, ["worktree", "list", "--porcelain"]).includes(".applepi/worktrees")).toBe(
        false,
      );
      expect(git(fixture, ["branch", "--list", "applepi/*"]).trim()).toBe("");
    } catch (err) {
      cleanup = false;
      console.log(`e2e fixture retained at: ${fixture}`);
      throw err;
    } finally {
      if (cleanup) {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  },
  { timeout: 10_800_000 },
);
