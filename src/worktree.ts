import { resolve } from "node:path";

function git(repoPath: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!proc.success) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(
      `git ${args.join(" ")} failed (exit ${proc.exitCode ?? "?"})${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return proc.stdout.toString();
}

export function createWorktree(
  repoPath: string,
  objectiveId: number,
  baseCommit: string,
): { path: string; branch: string } {
  const branch = `applepi/objective-${objectiveId}`;
  const relPath = `.applepi/worktrees/objective-${objectiveId}`;
  git(repoPath, ["worktree", "add", "-b", branch, relPath, baseCommit]);
  return { path: resolve(repoPath, relPath), branch };
}

export function removeWorktree(repoPath: string, path: string, branch: string): void {
  git(repoPath, ["worktree", "remove", path]);
  git(repoPath, ["branch", "-D", branch]);
}

export function repoBaseCommit(repoPath: string): string {
  return git(repoPath, ["rev-parse", "HEAD"]).trim();
}

export function assertCleanMain(repoPath: string): void {
  const status = git(repoPath, ["status", "--porcelain"]).trim();
  if (status !== "") {
    throw new Error(`main working tree is not clean: ${status}`);
  }
  if (git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() === "HEAD") {
    throw new Error("expected a branch checkout, found detached HEAD");
  }
}
