export type Segment = { instruction: string; commit_prefix: string };

export type CheckResult = {
  name: string;
  passed: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type VerifierResult = { passed: boolean; checks: CheckResult[] };

const TIMEOUT_MS = 600_000;

type Output = { command: string; exitCode: number | null; stdout: string; stderr: string };

async function run(cwd: string, args: string[]): Promise<Output> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = Bun.readableStreamToText(proc.stdout);
  const stderr = Bun.readableStreamToText(proc.stderr);
  try {
    const timer = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), TIMEOUT_MS),
    );
    const outcome = await Promise.race([
      proc.exited.then((code) => ({ code })),
      timer,
    ]);
    if (outcome === "timeout") {
      proc.kill();
      await proc.exited;
      const [out, err] = await Promise.all([stdout, stderr]);
      return {
        command: args.join(" "),
        exitCode: null,
        stdout: out,
        stderr: `${err}${err ? "\n" : ""}Command timed out after ${TIMEOUT_MS} ms and was killed.`,
      };
    }
    const [out, err] = await Promise.all([stdout, stderr]);
    return { command: args.join(" "), exitCode: outcome.code, stdout: out, stderr: err };
  } catch (e) {
    proc.kill();
    const [out, err] = await Promise.all([stdout, stderr]);
    return {
      command: args.join(" "),
      exitCode: null,
      stdout: out,
      stderr: `${err}${err ? "\n" : ""}Failed to run command: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function runCheck(
  cwd: string,
  name: string,
  args: string[],
  passed: (o: Output) => boolean,
): Promise<CheckResult> {
  const output = await run(cwd, args);
  return { name, passed: passed(output), ...output };
}

export async function verifyWorktree(
  worktreePath: string,
  baseCommit: string,
  segments: Segment[],
): Promise<VerifierResult> {
  const checks: CheckResult[] = [];

  checks.push(
    await runCheck(worktreePath, "clean worktree", ["git", "status", "--porcelain"], (o) =>
      o.exitCode === 0 && o.stdout.trim() === "",
    ),
  );

  checks.push(
    await runCheck(
      worktreePath,
      "has commits",
      ["git", "rev-list", "--count", `${baseCommit}..HEAD`],
      (o) => o.exitCode === 0 && Number(o.stdout.trim()) >= 1,
    ),
  );

  checks.push(
    await runCheck(
      worktreePath,
      "segment prefix attribution",
      ["git", "log", "--format=%s", `${baseCommit}..HEAD`],
      (o) => {
        if (o.exitCode !== 0) return false;
        const subjects = o.stdout.split("\n");
        return segments.every((seg) => subjects.some((s) => s.startsWith(seg.commit_prefix)));
      },
    ),
  );

  if (checks.every((c) => c.passed)) {
    checks.push(
      await runCheck(worktreePath, "install", ["bun", "install", "--frozen-lockfile"], (o) => o.exitCode === 0),
    );
    if (checks[checks.length - 1]!.passed) {
      checks.push(await runCheck(worktreePath, "check", ["bun", "run", "check"], (o) => o.exitCode === 0));
    }
  }

  return { passed: checks.every((c) => c.passed), checks };
}
