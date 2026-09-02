import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CaoRuntime } from "./cao-runtime";
import {
  createObjective,
  createTask,
  getObjective,
  openDatabase,
  setTaskCommitSha,
  updateObjectiveState,
  updateTaskState,
} from "./database";
import { assertCleanMain, createWorktree, removeWorktree, repoBaseCommit } from "./worktree";
import { verifyWorktree } from "./verifier";
import type { Segment } from "./verifier";

export type Io = {
  isTTY: boolean;
  readAnswer: (prompt: string) => Promise<string>;
  print: (text: string) => void;
};

const SEGMENT_PREFIX_RE = /^applepi-task-\d+:$/;
const PROCEED = "Proceed with your proposal.";

/** Phase A proposal-session instruction (plan Step 5, verbatim body). */
export function phaseAInstruction(cwd: string): string {
  return `You are ApplePI's executive for the repository at ${cwd}. Read docs/ROADMAP.md. Identify the next unfinished item in section 42 (IMPLEMENTATION ORDER) that can be completed as a bounded code change with deterministic checks; if the literal next item cannot (infrastructure proof, unavailable machinery, not a bounded code change), state why and propose the next implementable item. Write your clarification request to .applepi/clarification/request.json as JSON {"questions":[{"question":"...","choices":["...","..."]}]} with 1 to 3 questions, each with 2 to 4 choices. End your turn after writing the file. Do not modify any tracked files.`;
}

/** Phase B execution-session instruction (plan Step 5, verbatim body; {answer} substituted). */
export function phaseBInstruction(cwd: string, answer: string): string {
  return `You are ApplePI's executive for the repository at ${cwd}. The human answered your clarification: ${answer}. Finalize the chosen roadmap item from docs/ROADMAP.md section 42. Decompose the work into 1 to 4 smaller segments. Write .applepi/segments.json as JSON [{"instruction":"...","commit_prefix":"applepi-task-1:"},...] with unique prefixes applepi-task-<n>: (n starting at 1) and non-empty instructions. Then, for each segment IN ORDER, spawn one worker subagent via the Task tool with exactly that segment's instruction. Every worker instruction must end with: 'If node_modules is missing, run bun install --frozen-lockfile first. Implement the segment. Run the repository checks relevant to your change (bun run check is acceptable; it is fine if the e2e test skips). Commit with a message starting with <prefix>. Do not modify anything outside this worktree.' Do not commit anything yourself. Do not create any other commits. End your turn after all segments are done.`;
}

function git(repoPath: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: repoPath, stdout: "pipe", stderr: "pipe" });
  if (!proc.success) {
    const stderr = proc.stderr.toString().trim();
    throw new Error(
      `git ${args.join(" ")} failed (exit ${proc.exitCode ?? "?"})${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return proc.stdout.toString();
}

export type Question = { question: string; choices: string[] };

/** Validate the executive's clarification request: 1-3 questions, 2-4 string choices each. */
function parseRequest(text: string): Question[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("clarification/request.json is not valid JSON");
  }
  if (typeof data !== "object" || data === null || !("questions" in data)) {
    throw new Error("clarification/request.json must be a JSON object with a questions array");
  }
  const questions: unknown = data.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    throw new Error("clarification/request.json must contain 1 to 3 questions");
  }
  const out: Question[] = [];
  for (const q of questions) {
    if (typeof q !== "object" || q === null || !("question" in q) || !("choices" in q)) {
      throw new Error("each question must be an object with question and choices");
    }
    const question: unknown = q.question;
    const choices: unknown = q.choices;
    if (typeof question !== "string" || question.trim() === "") {
      throw new Error("each question must have a non-empty question string");
    }
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 4) {
      throw new Error("each question must have 2 to 4 choices");
    }
    const choiceStrings: string[] = [];
    for (const c of choices) {
      if (typeof c !== "string" || c.trim() === "") {
        throw new Error("each choice must be a non-empty string");
      }
      choiceStrings.push(c);
    }
    out.push({ question, choices: choiceStrings });
  }
  return out;
}

/** Validate segments.json: 1-4 segments, non-empty instructions, unique applepi-task-<n>: prefixes. */
function parseSegments(text: string): Segment[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("segments.json is not valid JSON");
  }
  if (!Array.isArray(data) || data.length < 1 || data.length > 4) {
    throw new Error("segments.json must be an array of 1 to 4 segments");
  }
  const seen: Record<string, true> = {};
  const out: Segment[] = [];
  for (const s of data) {
    if (typeof s !== "object" || s === null || !("instruction" in s) || !("commit_prefix" in s)) {
      throw new Error("each segment must have instruction and commit_prefix");
    }
    const instruction: unknown = s.instruction;
    const commitPrefix: unknown = s.commit_prefix;
    if (typeof instruction !== "string" || instruction.trim() === "") {
      throw new Error("each segment must have a non-empty instruction");
    }
    if (typeof commitPrefix !== "string" || !SEGMENT_PREFIX_RE.test(commitPrefix)) {
      throw new Error(`segment commit_prefix must match ${SEGMENT_PREFIX_RE.source}`);
    }
    if (seen[commitPrefix]) {
      throw new Error(`duplicate segment commit_prefix ${commitPrefix}`);
    }
    seen[commitPrefix] = true;
    out.push({ instruction, commit_prefix: commitPrefix });
  }
  return out;
}

/** A choice number picks that choice; anything else (or an out-of-range number) is free text; empty → PROCEED. */
function resolveAnswer(raw: string, choices: string[]): string {
  const trimmed = raw.trim();
  if (trimmed === "") return PROCEED;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n >= 1 && n <= choices.length) return choices[n - 1]!;
  }
  return raw;
}

export async function runObjective(
  repoPath: string,
  objectiveText: string,
  io: Io,
): Promise<number> {
  const runtime = new CaoRuntime(repoPath);
  let db: Database | null = null;
  let objectiveId: number | null = null;
  let worktreePath: string | null = null;
  let branch: string | null = null;
  try {
    // 1. Clean main, base commit, durable objective (running).
    assertCleanMain(repoPath);
    const baseCommit = repoBaseCommit(repoPath);
    db = openDatabase(repoPath);
    objectiveId = createObjective(db, {
      instruction: objectiveText,
      repository: repoPath,
      baseCommit,
    });
    io.print(`Objective ${objectiveId} created`);
    io.print(`base commit: ${baseCommit}`);

    // 2. Isolated worktree.
    const wt = createWorktree(repoPath, objectiveId, baseCommit);
    worktreePath = wt.path;
    branch = wt.branch;
    io.print(`worktree: ${wt.path}`);

    // 3. Phase A: executive proposes and asks for clarification.
    const workerA = await runtime.startWorker({
      cwd: wt.path,
      instruction: phaseAInstruction(wt.path),
    });
    const resultA = await runtime.wait(workerA);
    if (!resultA.ok) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Phase A failed (state: ${resultA.state}): ${resultA.detail}`);
      return 1;
    }
    let questions: Question[];
    try {
      questions = parseRequest(
        readFileSync(join(wt.path, ".applepi", "clarification", "request.json"), "utf8"),
      );
    } catch (err) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Invalid clarification request: ${(err as Error).message}`);
      return 1;
    }

    // 4. Clarification round.
    const answers: string[] = [];
    if (io.isTTY) {
      for (const q of questions) {
        io.print(`\n${q.question}`);
        q.choices.forEach((c, i) => io.print(`  ${i + 1}. ${c}`));
        io.print(`  Or type your own answer:`);
        answers.push(resolveAnswer(await io.readAnswer("Your answer: "), q.choices));
      }
    } else {
      const canned = process.env.APPLEPI_CLARIFY_ANSWER;
      if (canned === undefined) {
        updateObjectiveState(db, objectiveId, "failed");
        io.print("APPLEPI_CLARIFY_ANSWER is required when stdin is not a TTY");
        return 1;
      }
      for (const q of questions) answers.push(resolveAnswer(canned, q.choices));
    }
    const answersJson = JSON.stringify({ answers });
    mkdirSync(join(wt.path, ".applepi", "clarification"), { recursive: true });
    writeFileSync(join(wt.path, ".applepi", "clarification", "answer.json"), answersJson);

    // 5. Phase B: executive decomposes into segments and dispatches workers.
    const workerB = await runtime.startWorker({
      cwd: wt.path,
      instruction: phaseBInstruction(wt.path, answersJson),
    });
    const resultB = await runtime.wait(workerB);
    if (!resultB.ok) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Phase B failed (state: ${resultB.state}): ${resultB.detail}`);
      return 1;
    }

    // 6. Segments: validate, one task row per segment (pending → running).
    let segments: Segment[];
    try {
      segments = parseSegments(readFileSync(join(wt.path, ".applepi", "segments.json"), "utf8"));
    } catch (err) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Invalid segments.json: ${(err as Error).message}`);
      return 1;
    }
    const taskIds = segments.map((s) => createTask(db!, objectiveId!, s.instruction, wt.path));
    for (const id of taskIds) updateTaskState(db!, id, "running");

    // 7. Verify: tasks → verifying; deterministic checks gate integration.
    for (const id of taskIds) updateTaskState(db!, id, "verifying");
    const verifierResult = await verifyWorktree(wt.path, baseCommit, segments);

    if (verifierResult.passed) {
      const log = git(wt.path, ["log", "--format=%H %s", `${baseCommit}..HEAD`]).trim();
      const entries =
        log === ""
          ? []
          : log.split("\n").map((line) => {
              const sp = line.indexOf(" ");
              return { sha: line.slice(0, sp), subject: line.slice(sp + 1) };
            });
      const shortShas: string[] = [];
      segments.forEach((seg, i) => {
        const match = entries.find((e) => e.subject.startsWith(seg.commit_prefix));
        if (!match) throw new Error(`no commit found with prefix ${seg.commit_prefix}`);
        const short = git(wt.path, ["rev-parse", "--short", match.sha]).trim();
        setTaskCommitSha(db!, taskIds[i]!, short);
        updateTaskState(db!, taskIds[i]!, "completed");
        shortShas.push(short);
      });

      // Integrate: ff-only merge, cherry-pick fallback.
      try {
        git(repoPath, ["merge", "--ff-only", branch!]);
      } catch {
        git(repoPath, ["cherry-pick", `${baseCommit}..${branch!}`]);
      }
      const headSha = git(repoPath, ["rev-parse", "HEAD"]).trim();
      updateObjectiveState(db!, objectiveId!, "completed");
      removeWorktree(repoPath, wt.path, branch!);
      io.print(`Objective ${objectiveId} completed`);
      segments.forEach((seg, i) =>
        io.print(`  task ${taskIds[i]}: ${seg.commit_prefix} ${shortShas[i]}`),
      );
      io.print("verification: PASS");
      io.print(`integrated HEAD: ${headSha}`);
      return 0;
    }

    // Fail: no integration, worktree + branch preserved.
    for (const id of taskIds) updateTaskState(db!, id, "failed");
    updateObjectiveState(db!, objectiveId!, "failed");
    io.print(`Objective ${objectiveId} failed`);
    for (const check of verifierResult.checks) {
      if (check.passed) continue;
      io.print(`  ${check.name}: FAIL`);
      io.print(`    command: ${check.command}`);
      io.print(`    exit code: ${check.exitCode ?? "?"}`);
      if (check.stdout.trim() !== "") io.print(`    stdout: ${check.stdout.trim()}`);
      if (check.stderr.trim() !== "") io.print(`    stderr: ${check.stderr.trim()}`);
    }
    io.print(`Worktree retained: ${wt.path}`);
    return 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.print(`Objective failed: ${message}`);
    if (db !== null && objectiveId !== null) {
      const objective = getObjective(db, objectiveId);
      if (objective && objective.state === "running") {
        updateObjectiveState(db, objectiveId, "failed");
      }
    }
    return 1;
  } finally {
    // 8. Server lifecycle: kill only what ApplePI spawned. Idempotent.
    await runtime.stopServer();
  }
}
