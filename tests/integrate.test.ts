import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrateBranch } from "../src/integrate";

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

function run(args: string[], dir: string): { ok: boolean; stdout: string } {
  const proc = Bun.spawnSync(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { ok: proc.success, stdout: proc.stdout.toString() };
}

test("integrates via fast-forward when main has not advanced", () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-integrate-ff-"));
  try {
    git(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, "file.txt"), "base\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    const base = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "file.txt"), "worker\n");
    git(dir, ["commit", "-am", "applepi-task-1: worker"]);
    const featureSha = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["checkout", "main"]);

    const result = integrateBranch(dir, base, "feature");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.headSha).toBe(featureSha);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("integrates via cherry-pick when main advanced with unrelated commits", () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-integrate-pick-"));
  try {
    git(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, "file.txt"), "base\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    const base = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "file.txt"), "worker\n");
    git(dir, ["commit", "-am", "applepi-task-1: worker"]);
    git(dir, ["checkout", "main"]);
    writeFileSync(join(dir, "other.txt"), "main advance\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "main advance"]);

    const result = integrateBranch(dir, base, "feature");
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, "file.txt"), "utf8").trim()).toBe("worker");
    expect(readFileSync(join(dir, "other.txt"), "utf8").trim()).toBe("main advance");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conflict failure aborts the cherry-pick and leaves main clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-integrate-conflict-"));
  try {
    git(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, "file.txt"), "base\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    const base = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["checkout", "-b", "feature"]);
    writeFileSync(join(dir, "file.txt"), "worker change\n");
    git(dir, ["commit", "-am", "applepi-task-1: worker change"]);
    git(dir, ["checkout", "main"]);
    writeFileSync(join(dir, "file.txt"), "main change\n");
    git(dir, ["commit", "-am", "main change"]);

    const result = integrateBranch(dir, base, "feature");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cherry-pick");

    // No CHERRY_PICK_HEAD and no unresolved cherry-pick state.
    const cherryPickHead = run(["git", "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"], dir);
    expect(cherryPickHead.ok).toBe(false);
    expect(run(["git", "status", "--porcelain"], dir).stdout.trim()).toBe("");

    // The branch still exists for inspection.
    expect(git(dir, ["branch", "--list", "feature"]).trim()).toBe("feature");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
