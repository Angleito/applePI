import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { CaoRuntime, type AgentRuntime } from "./cao-runtime";
import {
  createObjective,
  createTask,
  getObjective,
  getTasksForObjective,
  openDatabase,
  setTaskCommitSha,
  updateObjectiveState,
  updateTaskState,
} from "./database";
import { integrateBranch } from "./integrate";
import { assertCleanMain, createWorktree, removeWorktree, repoBaseCommit } from "./worktree";
import { verifyWorktree } from "./verifier";
import type { Segment, VerifierResult } from "./verifier";

export type Io = {
  isTTY: boolean;
  readAnswer: (prompt: string) => Promise<string>;
  print: (text: string) => void;
};

const SEGMENT_PREFIX_RE = /^applepi-task-\d+:$/;
const PROCEED = "Proceed with your proposal.";

/** Phase A proposal-session instruction: understand the HUMAN objective (authoritative) and ask for clarification. */
export function phaseAInstruction(cwd: string, objectiveText: string): string {
  return `You are ApplePI's Executive for the repository at ${cwd}.

HUMAN OBJECTIVE:
${objectiveText}

This human objective is authoritative. Your job is to understand and execute it.
Read the repository and relevant documentation as context. If the objective asks you to follow the roadmap, inspect docs/ROADMAP.md. Otherwise, do not replace the objective with a roadmap task.
The human is in the loop and is the authority for every decision and opinion; you decide only code. For every point requiring a decision or preference, ask one bounded question with 2 to 4 choices (1 to 3 questions total).
Write your clarification request to .applepi/clarification/request.json as JSON {"questions":[{"question":"...","choices":["...","..."]}]}.
Identify one bounded implementation direction. End your turn after writing the file. Do not modify any tracked files.`;
}

/** Phase B1 decomposition-session instruction: finalize direction and decompose into segments; no workers. */
export function phaseB1Instruction(cwd: string, objectiveText: string, answersJson: string): string {
  return `You are ApplePI's Executive for the repository at ${cwd}.

HUMAN OBJECTIVE:
${objectiveText}

The human answered your clarification: ${answersJson}.
Finalize the bounded implementation direction from the human objective. Decompose the work into 1 to 4 smaller segments. Write .applepi/segments.json as JSON [{"instruction":"...","commit_prefix":"applepi-task-1:"},...] with unique prefixes applepi-task-<n>: (n starting at 1) and non-empty instructions. Do NOT spawn any worker subagents. Do NOT modify tracked files. Do NOT create any commits. End your turn after writing the file.`;
}

/** Phase B2 execution-session instruction: run the persisted segments exactly as recorded. */
export function phaseB2Instruction(cwd: string, segmentsJson: string): string {
  return `You are ApplePI's Executive for the repository at ${cwd}.

These segments have already been accepted and persisted by ApplePI. Execute exactly these segments in order: ${segmentsJson}. For each segment: spawn one worker subagent via the Task tool with exactly that segment's instruction; require the supplied commit prefix; require the worker to run the repository checks relevant to its change and commit with a message starting with the prefix; end the worker instruction with 'Do not modify anything outside this worktree.' Do not add, remove, merge, or reinterpret segments. Do not regenerate or rewrite segments.json. Do not create any commits yourself. End your turn after all segments are done.`;
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
  runtime: AgentRuntime = new CaoRuntime(repoPath),
  verify: (
    worktreePath: string,
    baseCommit: string,
    segments: Segment[],
  ) => Promise<VerifierResult> = verifyWorktree,
): Promise<number> {
  let db: Database | null = null;
  let objectiveId: number | null = null;
  let worktreePath: string | null = null;
  let branch: string | null = null;
  let taskIds: number[] = [];
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

    // 3. Phase A: executive understands the human objective and asks for clarification.
    const workerA = await runtime.startWorker({
      cwd: wt.path,
      phase: "a",
      instruction: phaseAInstruction(wt.path, objectiveText),
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

    // 5. Phase B1: executive finalizes the direction and decomposes into segments only.
    const workerB1 = await runtime.startWorker({
      cwd: wt.path,
      phase: "b1",
      instruction: phaseB1Instruction(wt.path, objectiveText, answersJson),
    });
    const resultB1 = await runtime.wait(workerB1);
    if (!resultB1.ok) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Phase B1 failed (state: ${resultB1.state}): ${resultB1.detail}`);
      return 1;
    }

    // 6. Durability boundary: validate segments, then persist one task row per
    // segment BEFORE any execution starts, so a crash mid-run leaves a record.
    let segments: Segment[];
    try {
      segments = parseSegments(readFileSync(join(wt.path, ".applepi", "segments.json"), "utf8"));
    } catch (err) {
      updateObjectiveState(db, objectiveId, "failed");
      io.print(`Invalid segments.json: ${(err as Error).message}`);
      return 1;
    }
    taskIds = segments.map((s) => createTask(db!, objectiveId!, s.instruction, wt.path));
    for (const id of taskIds) updateTaskState(db!, id, "running");

    // 7. Phase B2: executive executes exactly the persisted segments.
    const workerB2 = await runtime.startWorker({
      cwd: wt.path,
      phase: "b2",
      instruction: phaseB2Instruction(wt.path, JSON.stringify(segments)),
    });
    const resultB2 = await runtime.wait(workerB2);
    if (!resultB2.ok) {
      for (const id of taskIds) updateTaskState(db!, id, "failed");
      updateObjectiveState(db!, objectiveId!, "failed");
      io.print(`Phase B2 failed (state: ${resultB2.state}): ${resultB2.detail}`);
      io.print(`Worktree retained: ${wt.path}`);
      return 1;
    }

    // 8. Verify: tasks → verifying; deterministic checks gate integration.
    for (const id of taskIds) updateTaskState(db!, id, "verifying");
    const verifierResult = await verify(wt.path, baseCommit, segments);

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
        // SHA persisted pre-integration for diagnostics; state stays "verifying".
        setTaskCommitSha(db!, taskIds[i]!, short);
        shortShas.push(short);
      });

      // 9. Integrate: completion requires verification PASS + successful integration.
      const integration = integrateBranch(repoPath, baseCommit, branch!);
      if (!integration.ok) {
        for (const id of taskIds) updateTaskState(db!, id, "failed");
        updateObjectiveState(db!, objectiveId!, "failed");
        io.print(`Objective ${objectiveId} failed`);
        io.print(`Integration failed: ${integration.error}`);
        io.print(`Worktree retained: ${wt.path}`);
        return 1;
      }
      // Success: completion states before worktree removal, per invariant.
      for (const id of taskIds) updateTaskState(db!, id, "completed");
      updateObjectiveState(db!, objectiveId!, "completed");
      removeWorktree(repoPath, wt.path, branch!);
      io.print(`Objective ${objectiveId} completed`);
      segments.forEach((seg, i) =>
        io.print(`  task ${taskIds[i]}: ${seg.commit_prefix} ${shortShas[i]}`),
      );
      io.print("verification: PASS");
      io.print(`integrated HEAD: ${integration.headSha}`);
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
      // Only in-flight tasks flip to failed; completed/failed stay as-is.
      for (const task of getTasksForObjective(db, objectiveId)) {
        if (task.state === "pending" || task.state === "running" || task.state === "verifying") {
          updateTaskState(db, task.id, "failed");
        }
      }
    }
    return 1;
  } finally {
    // Server lifecycle: kill only what ApplePI spawned. Idempotent.
    await runtime.stopServer();
  }
}
