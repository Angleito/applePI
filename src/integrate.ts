export type IntegrationResult =
  | { ok: true; headSha: string }
  | { ok: false; error: string };

type GitOutcome = { ok: boolean; stdout: string; stderr: string };

function git(repoPath: string, args: string[]): GitOutcome {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: proc.success, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/**
 * Integrates the applepi worktree branch into main.
 *
 * 1. Fast-forward merge when main has not advanced past the base.
 * 2. Otherwise cherry-pick the branch's commits (base..branch) onto main.
 * 3. On cherry-pick failure: abort, so no CHERRY_PICK_HEAD or unresolved
 *    cherry-pick state survives in repoPath. Cleanup failures are surfaced.
 */
export function integrateBranch(
  repoPath: string,
  baseCommit: string,
  branch: string,
): IntegrationResult {
  const ff = git(repoPath, ["merge", "--ff-only", branch]);
  if (ff.ok) {
    return { ok: true, headSha: git(repoPath, ["rev-parse", "HEAD"]).stdout.trim() };
  }

  const pick = git(repoPath, ["cherry-pick", `${baseCommit}..${branch}`]);
  if (pick.ok) {
    return { ok: true, headSha: git(repoPath, ["rev-parse", "HEAD"]).stdout.trim() };
  }

  const pickError = `git cherry-pick ${baseCommit}..${branch} failed: ${pick.stderr.trim()}`;
  const abort = git(repoPath, ["cherry-pick", "--abort"]);
  if (abort.ok || abort.stderr.includes("no cherry-pick in progress")) {
    return { ok: false, error: pickError };
  }
  return {
    ok: false,
    error: `${pickError} (cleanup: git cherry-pick --abort failed: ${abort.stderr.trim()})`,
  };
}
