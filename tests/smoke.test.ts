import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createObjective,
  createTask,
  getObjective,
  getTasksForObjective,
  openDatabase,
  setTaskCommitSha,
  updateObjectiveState,
  updateTaskState,
} from "../src/database";

describe("database", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "applepi-smoke-"));
  const dbPath = path.join(dir, "repo");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("round-trips objectives and tasks with exact initial states", () => {
    const db = openDatabase(dbPath);
    const objectiveId = createObjective(db, {
      instruction: "Implement the next roadmap item",
      repository: dbPath,
      baseCommit: "abc123",
    });

    const objective = getObjective(db, objectiveId);
    expect(objective).not.toBeNull();
    expect(objective!.id).toBe(objectiveId);
    expect(objective!.instruction).toBe("Implement the next roadmap item");
    expect(objective!.repository).toBe(dbPath);
    expect(objective!.base_commit).toBe("abc123");
    expect(objective!.state).toBe("running");
    expect(objective!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(objective!.updated_at).toBe(objective!.created_at);

    const taskId = createTask(db, objectiveId, "Segment 1");
    const tasks = getTasksForObjective(db, objectiveId);
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.id).toBe(taskId);
    expect(task.objective_id).toBe(objectiveId);
    expect(task.instruction).toBe("Segment 1");
    expect(task.state).toBe("pending");
    expect(task.worktree_path).toBeNull();
    expect(task.worker_id).toBeNull();
    expect(task.commit_sha).toBeNull();
  });

  test("persists state transitions and commit sha", () => {
    const db = openDatabase(dbPath);
    const objectiveId = createObjective(db, {
      instruction: "Two",
      repository: dbPath,
      baseCommit: "def456",
    });
    const taskId = createTask(db, objectiveId, "Segment A");

    updateTaskState(db, taskId, "running");
    expect(getTasksForObjective(db, objectiveId)[0]!.state).toBe("running");

    updateTaskState(db, taskId, "verifying");
    expect(getTasksForObjective(db, objectiveId)[0]!.state).toBe("verifying");

    setTaskCommitSha(db, taskId, "deadbeef");
    const committed = getTasksForObjective(db, objectiveId)[0]!;
    expect(committed.state).toBe("verifying");
    expect(committed.commit_sha).toBe("deadbeef");
    expect(committed.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    updateTaskState(db, taskId, "completed");
    expect(getTasksForObjective(db, objectiveId)[0]!.state).toBe("completed");

    updateObjectiveState(db, objectiveId, "completed");
    expect(getObjective(db, objectiveId)!.state).toBe("completed");
  });

  test("openDatabase is idempotent and reopens persisted data", () => {
    const db = openDatabase(dbPath);
    const objectiveId = createObjective(db, {
      instruction: "Three",
      repository: dbPath,
      baseCommit: "ghi789",
    });

    // Second open on the same repo must not clobber existing rows.
    const reopened = openDatabase(dbPath);
    const objective = getObjective(reopened, objectiveId);
    expect(objective).not.toBeNull();
    expect(objective!.instruction).toBe("Three");
    expect(objective!.state).toBe("running");

    // New objective ids keep incrementing across opens.
    const nextId = createObjective(reopened, {
      instruction: "Four",
      repository: dbPath,
      baseCommit: "jkl012",
    });
    expect(nextId).toBeGreaterThan(objectiveId);
  });
});
