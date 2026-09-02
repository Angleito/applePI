import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWorktree } from "../src/verifier";

const SEGMENT = { instruction: "do the thing", commit_prefix: "applepi-task-1:" };

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

test("verifier fails on a repo with no commits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-verifier-empty-"));
  try {
    git(dir, ["init", "-b", "main"]);
    const result = await verifyWorktree(dir, "HEAD", [SEGMENT]);
    expect(result.passed).toBe(false);
    const byName = new Map(result.checks.map((c) => [c.name, c]));
    expect(byName.get("has commits")?.passed).toBe(false);
    expect(byName.get("segment prefix attribution")?.passed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifier flags a dirty worktree but counts its commits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-verifier-dirty-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["commit", "--allow-empty", "-m", "init"]);
    writeFileSync(join(dir, "untracked.txt"), "dirty\n");
    const base = git(dir, ["hash-object", "-t", "tree", "/dev/null"]).trim();
    const result = await verifyWorktree(dir, base, [SEGMENT]);
    const byName = new Map(result.checks.map((c) => [c.name, c]));
    expect(byName.get("clean worktree")?.passed).toBe(false);
    expect(byName.get("has commits")?.passed).toBe(true);
    expect(result.passed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifier rejects commits whose subject lacks the segment prefix", async () => {
  const dir = mkdtempSync(join(tmpdir(), "applepi-verifier-prefix-"));
  try {
    git(dir, ["init", "-b", "main"]);
    git(dir, ["commit", "--allow-empty", "-m", "init"]);
    const base = git(dir, ["rev-parse", "HEAD"]).trim();
    git(dir, ["commit", "--allow-empty", "-m", "plain commit without prefix"]);
    const result = await verifyWorktree(dir, base, [SEGMENT]);
    const byName = new Map(result.checks.map((c) => [c.name, c]));
    expect(byName.get("segment prefix attribution")?.passed).toBe(false);
    expect(result.passed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
